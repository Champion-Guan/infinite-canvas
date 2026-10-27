import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function load(host) {
    const source = readFileSync(new URL('../扩展功能/软件更新/软件更新客户端.ts', import.meta.url), 'utf8');
    const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} }, window = { __guanUpdateHost: host };
    new Function('module', 'exports', 'window', javascript)(module, module.exports, window);
    return { request: module.exports.updateRequest, window };
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

test('并发状态读取共用一次请求，完成后下一次读取获取最新状态', async () => {
    const first = deferred(), calls = [];
    const { request } = load({ request(operation) { calls.push(operation); return calls.length === 1 ? first.promise : Promise.resolve({ version: 2 }); } });
    const reads = Array.from({ length: 12 }, () => request('status'));
    assert.equal(calls.length, 1);
    first.resolve({ version: 1 });
    assert.deepEqual(await Promise.all(reads), Array.from({ length: 12 }, () => ({ version: 1 })));
    assert.deepEqual(await request('status'), { version: 2 });
    assert.equal(calls.length, 2);
});

test('读取失败后可立即重试，错误不会成为永久缓存', async () => {
    let calls = 0;
    const { request } = load({ async request() { if (++calls === 1) throw { code: 'proxy_unavailable' }; return { recovered: true }; } });
    await assert.rejects(request('status'), /本地代理不可用/);
    assert.deepEqual(await request('status'), { recovered: true });
    assert.equal(calls, 2);
});

test('更新操作不合并；写入后刷新不复用写入前在途结果', async () => {
    const old = deferred(), calls = [];
    const { request } = load({ request(operation, input) { calls.push([operation, input]); return calls.length === 1 ? old.promise : Promise.resolve({ revision: calls.length }); } });
    const pending = request('status');
    await request('preferences', { autoDownload: false });
    assert.deepEqual(await request('status'), { revision: 3 });
    old.resolve({ revision: 1 }); await pending;
    await Promise.all([request('check'), request('check')]);
    assert.deepEqual(calls.map(([operation]) => operation), ['status', 'preferences', 'status', 'check', 'check']);
});

test('服务重连后的新端口不共享旧连接的状态请求', async () => {
    const old = deferred();
    const api = load({ request: () => old.promise });
    const pending = api.request('status');
    api.window.__guanUpdateHost = { request: async () => ({ connection: 'new' }) };
    assert.deepEqual(await api.request('status'), { connection: 'new' });
    old.resolve({ connection: 'old' }); await pending;
});

test('隐藏产品和后台标签不轮询，重新可见立即刷新，卸载清理定时器和监听', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    let active = true, calls = 0;
    const listeners = new Set(), cleanups = [];
    const document = { visibilityState: 'hidden', addEventListener: (_name, callback) => listeners.add(callback), removeEventListener: (_name, callback) => listeners.delete(callback) };
    const dependencies = {
        react: { useCallback: callback => callback, useMemo: callback => callback(), useState: () => [null, () => {}], useEffect: callback => { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); } },
        '@/扩展功能/产品/产品界面边界': { useProductActive: () => active },
        antd: { App: { useApp: () => ({ message: {} }) } }, '@/constant/env': { APP_VERSION: 'test' },
        '@/扩展功能/软件更新/软件更新客户端': { updateRequest: async () => { calls++; return {}; }, updateMessages: {} },
    };
    const source = readFileSync(new URL('../.运行/3100源/画布副本/web/src/hooks/use-version-check.ts', import.meta.url), 'utf8');
    const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'document', '__APP_RELEASES__', javascript)(id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, module, module.exports, document, []);
    const render = () => module.exports.useVersionCheck();
    const unmount = () => { while (cleanups.length) cleanups.pop()(); };
    render(); t.mock.timers.tick(60000); assert.equal(calls, 0);
    document.visibilityState = 'visible'; for (const listener of listeners) listener();
    assert.equal(calls, 1); t.mock.timers.tick(30000); assert.equal(calls, 2);
    unmount(); active = false; render(); t.mock.timers.tick(60000);
    assert.equal(calls, 2); assert.equal(listeners.size, 0);
    unmount(); active = true; render(); assert.equal(calls, 3);
    unmount(); t.mock.timers.tick(60000); assert.equal(calls, 3); assert.equal(listeners.size, 0);
});
