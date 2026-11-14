import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';
import { createServer } from 'node:http';
import { 创建本地转发 } from '../扩展功能/网络代理/本地转发服务.mjs';
import { requestProviderBytes } from '../扩展功能/生成网关/受限上游传输.mjs';
import { requestThroughManagedProxy } from '../扩展功能/故障切换/受限代理传输.mjs';

function fixture(send) {
    return variantModules({
        '../网络代理/本地转发请求': { 本地转发地址: url => 'http://localhost/relay/' + url, 本地转发请求: send },
    }).load('提示词/提示词远程图片.ts');
}
const response = (content = 'image') => ({ ok: true, blob: async () => new Blob([content], { type: 'image/png' }) });

test('提示词图片经本机转发，同地址并发合并，重复显示复用Blob缓存', async () => {
    const calls = [];
    const api = fixture(async (url, options) => { calls.push({ url, options }); return response(); });
    const [one, two] = await Promise.all([api.readPromptImage('https://cdn.example/a.png'), api.readPromptImage('https://cdn.example/a.png')]);
    assert.equal(one, two);
    assert.equal(await api.readPromptImage('https://cdn.example/a.png'), one);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://localhost/relay/https://cdn.example/a.png');
    assert.ok(calls[0].options.signal);
    assert.equal(calls[0].options.headers.accept, 'image/*');
});

test('匿名图片最多三次跳转，每跳校验公开HTTPS地址，不给认证请求开放跳转', async () => {
    const calls = [];
    let redirect = 'https://images.example.com/final.png', repeat = false;
    const relay = 创建本地转发({ proxy: { status: () => ({ relayEnabled: true, enabled: false }), acquireRoute: () => ({ release() {} }) },
        direct: async request => {
            calls.push(request);
            return calls.length === 1 || repeat ? { status: 302, redirectLocation: redirect }
                : { status: 200, contentType: 'image/png', bytes: Buffer.from('image') };
        } });
    const request = { url: 'https://github.com/user-attachments/assets/test', method: 'GET', body: '', headers: { accept: 'image/*' } };
    assert.equal((await relay(request)).status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url.href, redirect);
    assert.ok(calls.every(call => call.allowImageRedirect && !call.headers.authorization));
    for (const destination of ['http://images.example.com/a', 'https://127.0.0.1/a', 'https://u:p@images.example.com/a']) {
        calls.length = 0; redirect = destination;
        await assert.rejects(relay(request));
        assert.equal(calls.length, 1);
    }
    calls.length = 0; redirect = 'https://images.example.com/loop'; repeat = true;
    await assert.rejects(relay(request), /跳转次数/);
    assert.equal(calls.length, 4);
    calls.length = 0;
    await assert.rejects(relay({ ...request, headers: { accept: 'image/*', authorization: 'Bearer synthetic-secret' } }), /跳转次数/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].allowImageRedirect, false);
});

test('真实直连传输默认拒绝跳转，仅匿名图片返回目标，代理传输也拒绝带密钥的例外', async t => {
    const server = createServer((_request, response) => { response.writeHead(302, { location: 'https://images.example.com/a.png' }); response.end(); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const options = { url: new URL(origin), method: 'GET', headers: { accept: 'image/*' }, bytes: Buffer.alloc(0), testOrigins: [origin] };
    await assert.rejects(requestProviderBytes(options), error => error.code === 'provider_redirect_denied');
    const result = await requestProviderBytes({ ...options, allowImageRedirect: true });
    assert.equal(result.redirectLocation, 'https://images.example.com/a.png');
    assert.throws(() => requestProviderBytes({ ...options, headers: { ...options.headers, authorization: 'Bearer synthetic' }, allowImageRedirect: true }),
        error => error.code === 'provider_redirect_denied');
    await assert.rejects(requestThroughManagedProxy({ ...options, url: new URL('https://images.example.com/a'), allowImageRedirect: true,
        headers: { ...options.headers, authorization: 'Bearer synthetic' }, route: { proxyURL: 'http://127.0.0.1:1', username: 'a', password: 'b' } }),
        error => error.code === 'provider_redirect_denied');
});

test('可见图片排队，取消一个使用者不取消其他使用者，离屏排队请求不发送', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; }), calls = [];
    const api = fixture(async url => { calls.push(url); await gate; return response(); });
    const first = new AbortController(), queued = new AbortController();
    const aborted = api.readPromptImage('https://cdn.example/a.png', first.signal);
    const kept = api.readPromptImage('https://cdn.example/a.png');
    const canceled = api.readPromptImage('https://cdn.example/b.png', queued.signal);
    const outcomes = Promise.allSettled([aborted, kept, canceled]);
    await new Promise(resolve => setImmediate(resolve));
    first.abort(); queued.abort(); release();
    assert.deepEqual((await outcomes).map(item => item.status), ['rejected', 'fulfilled', 'rejected']);
    assert.equal(calls.length, 1);
});

test('失败不缓存也不阻断下一张；非图片响应不冒充图片，禁止明文远程地址', async () => {
    let count = 0;
    const api = fixture(async () => ++count === 1 ? { ok: true, blob: async () => new Blob(['error'], { type: 'text/html' }) } : response());
    await assert.rejects(api.readPromptImage('https://cdn.example/a.png'), /有效图片/);
    await api.readPromptImage('https://cdn.example/a.png');
    await assert.rejects(api.readPromptImage('http://cdn.example/a.png'), /HTTPS/);
    assert.equal(count, 2);
});

test('图片缓存有界，超过64张后淘汰最旧项，命中会更新保留顺序', async () => {
    let count = 0;
    const api = fixture(async () => { count++; return response(); });
    for (let index = 0; index < 64; index++) await api.readPromptImage(`https://cdn.example/${index}.png`);
    await api.readPromptImage('https://cdn.example/0.png');
    await api.readPromptImage('https://cdn.example/64.png');
    await api.readPromptImage('https://cdn.example/0.png');
    assert.equal(count, 65);
    await api.readPromptImage('https://cdn.example/1.png');
    assert.equal(count, 66);
});
