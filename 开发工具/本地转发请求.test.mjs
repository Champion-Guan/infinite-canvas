import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const webRequire = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = webRequire('./node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js');
const source = readFileSync(new URL('../扩展功能/网络代理/本地转发请求.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
function fixture(relay = async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"ok":true}').toString('base64') })) {
  const calls = [], exports = {};
  const context = { exports, require: webRequire, Request, Response, Headers, URL, FormData, Uint8Array, AbortController, setTimeout, clearTimeout, btoa, atob,
    window: { location: { origin: 'http://localhost:3001', href: 'http://localhost:3001/canvas/test' }, __guanNetworkProxyHost: { relay(...args) { calls.push(args); return relay(...args); } } },
    fetch: async request => { calls.push(request); return new Response('native'); } };
  runInNewContext(compiled, context, { filename: fileURLToPath(new URL('../扩展功能/网络代理/本地转发请求.ts', import.meta.url)) });
  return { api: exports, calls };
}
test('相对URL走原fetch，本地逻辑URL经授权转发并保留JSON语义', async () => {
  const f = fixture();
  assert.equal(await (await f.api.本地转发请求('/logo.svg')).text(), 'native'); assert.equal(f.calls[0].url, 'http://localhost:3001/logo.svg');
  const result = await f.api.本地转发Axios.post(f.api.本地转发地址('https://api.example.com/v1/test'), { text: '合成文本' });
  assert.equal(result.data.ok, true); const [request] = f.calls[1]; assert.equal(request.url, 'https://api.example.com/v1/test');
  assert.equal(JSON.parse(Buffer.from(request.body, 'base64').toString()).text, '合成文本');
});
test('FormData生成真实边界，二进制响应及204不损坏', async () => {
  const f = fixture(async () => ({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from([1, 2, 255]).toString('base64') }));
  const form = new FormData(); form.append('prompt', '合成提示词');
  const result = await f.api.本地转发Axios.post(f.api.本地转发地址('https://api.example.com/v1/edit'), form, { responseType: 'arraybuffer' });
  const [request] = f.calls[0]; assert.match(request.headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.ok(Buffer.from(request.body, 'base64').includes(Buffer.from('合成提示词'))); assert.deepEqual([...new Uint8Array(result.data)], [1, 2, 255]);
  const empty = fixture(async () => ({ status: 204, headers: {}, body: '' }));
  assert.equal((await empty.api.本地转发请求(empty.api.本地转发地址('https://api.example.com/check'))).status, 204);
});
test('取消fetch保留AbortError，取消Axios保留isCancel，均不自动重发', async () => {
  const f = fixture((_request, { signal }) => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(Error('synthetic abort')), { once: true }); }));
  for (const axios of [false, true]) {
    const controller = new AbortController(), url = f.api.本地转发地址('https://api.example.com/test');
    const request = axios ? f.api.本地转发Axios.get(url, { signal: controller.signal }) : f.api.本地转发请求(url, { signal: controller.signal });
    // Request读取正文的微任务完成后再取消，覆盖发送后的取消路径。
    await new Promise(done => setImmediate(done)); controller.abort();
    await assert.rejects(request, error => axios ? f.api.本地转发Axios.isCancel(error) : error.name === 'AbortError');
  }
  assert.equal(f.calls.length, 2);
});
