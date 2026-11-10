import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const releaseModule = { exports: {} };
new Function('module', 'exports', ts.transpileModule(
    readFileSync(new URL('../.运行/3100源/画布副本/web/src/lib/release.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText)(releaseModule, releaseModule.exports);
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
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let active = true, calls = 0;
    const listeners = new Set(), cleanups = [];
    const document = { visibilityState: 'hidden', addEventListener: (_name, callback) => listeners.add(callback), removeEventListener: (_name, callback) => listeners.delete(callback) };
    const dependencies = {
        react: { useCallback: callback => callback, useMemo: callback => callback(), useState: () => [null, () => {}], useEffect: callback => { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); } },
        '@/扩展功能/产品/产品界面边界': { useProductActive: () => active },
        antd: { App: { useApp: () => ({ message: {} }) } }, '@/constant/env': { APP_VERSION: 'test' },
        '@/扩展功能/软件更新/软件更新客户端': { updateRequest: async () => { calls++; return {}; }, updateMessages: {} },
        '@/lib/release': releaseModule.exports,
    };
    const pollingModule = { exports: {} };
    const pollingCode = ts.transpileModule(readFileSync(new URL('../扩展功能/主题/可见页面轮询.ts', import.meta.url), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', 'document', pollingCode)(() => dependencies.react, pollingModule, pollingModule.exports, document);
    dependencies['@/扩展功能/主题/可见页面轮询'] = pollingModule.exports;
    const source = readFileSync(new URL('../.运行/3100源/画布副本/web/src/hooks/use-version-check.ts', import.meta.url), 'utf8');
    const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'document', '__APP_RELEASES__', javascript)(id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, module, module.exports, document, []);
    const render = () => module.exports.useVersionCheck();
    const unmount = () => { while (cleanups.length) cleanups.pop()(); };
    render(); t.mock.timers.tick(60000); assert.equal(calls, 0);
    document.visibilityState = 'visible'; for (const listener of listeners) listener();
    assert.equal(calls, 1); await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(30000); assert.equal(calls, 2);
    unmount(); active = false; render(); t.mock.timers.tick(60000);
    assert.equal(calls, 2); assert.equal(listeners.size, 0);
    unmount(); active = true; render(); assert.equal(calls, 3);
    unmount(); t.mock.timers.tick(60000); assert.equal(calls, 3); assert.equal(listeners.size, 0);
});

test('在线更新日志沿用逐条分类标签，发布身份采用服务端，旧说明和本地历史保留', () => {
    const localReleases = [{ version: '2.0.0-beta.22', items: [{ type: '修复', content: '本地旧摘要' }] },
        { version: '0.19.0', items: [{ type: '优化', content: '缩略图渲染' }] }];
    let status, stateIndex;
    const dependencies = {
        react: { useCallback: callback => callback, useMemo: callback => callback(), useState: initial => [stateIndex++ === 0 ? status : initial, () => {}], useEffect() {} },
        '@/扩展功能/产品/产品界面边界': { useProductActive: () => true },
        antd: { App: { useApp: () => ({ message: {} }) } }, '@/constant/env': { APP_VERSION: 'test' },
        '@/扩展功能/软件更新/软件更新客户端': { updateRequest: async () => ({}), updateMessages: {} },
        '@/lib/release': releaseModule.exports,
        '@/扩展功能/主题/可见页面轮询': { useVisiblePolling() {} },
    };
    const source = readFileSync(new URL('../.运行/3100源/画布副本/web/src/hooks/use-version-check.ts', import.meta.url), 'utf8');
    const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', '__APP_RELEASES__', javascript)(
        id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, module, module.exports, localReleases);
    const render = notes => {
        stateIndex = 0;
        status = { preferences: { developerMode: true }, latest: { version: '2.0.0-beta.22', publishedAt: '2026-11-02T04:00:00Z', notes } };
        return module.exports.useVersionCheck().releases;
    };
    const items = ['新增', '优化', '调整', '修复', '文档'].map(type => ({ type, content: `${type}对应的一项用户可见变化。` }));
    const categorized = render('## 2.0.0-beta.22 - 2026-11-01\r\n\r\n' + items.map(item => `+ [${item.type}] ${item.content}`).join('\r\n'));
    assert.deepEqual(categorized, [{ version: '2.0.0-beta.22', date: '2026-11-02', items }, localReleases[1]]);
    assert.deepEqual(render('+ [修复] 单项说明。')[0].items, [{ type: '修复', content: '单项说明。' }]);
    const legacy = '# 生图工作台 Web beta.21\n\n- 修复桌面入口。\n\n首次安装：解压后启动。';
    assert.deepEqual(render(legacy)[0].items, [{ type: '更新', content: legacy }]);
    assert.deepEqual(render('')[0].items, [{ type: '更新', content: '暂无更新说明' }]);
    status = null; stateIndex = 0;
    assert.deepEqual(module.exports.useVersionCheck().releases, [localReleases[1]]);
});

test('Beta历史跟随已保存的开发者模式，关闭及尚未读取时隐藏，重新开启恢复且不改当前版本', () => {
    const localReleases = [
        { version: '2.1.0-beta.2', date: '2026-11-08', items: [{ type: '新增', content: 'Beta说明' }] },
        { version: '2.0.0', date: '2026-11-07', items: [{ type: '修复', content: '正式说明' }] },
        { version: 'v1.9.0-beta+build.7', date: '2026-11-06', items: [{ type: '修复', content: '带元数据的Beta说明' }] },
        { version: '1.8.0+beta.docs', date: '2026-11-05', items: [{ type: '文档', content: '正式版构建元数据不是Beta' }] },
    ];
    const before = structuredClone(localReleases);
    let status = null, stateIndex = 0;
    const dependencies = {
        react: { useCallback: callback => callback, useMemo: callback => callback(), useState: initial => [stateIndex++ === 0 ? status : initial, () => {}] },
        '@/扩展功能/产品/产品界面边界': { useProductActive: () => true },
        antd: { App: { useApp: () => ({ message: {} }) } }, '@/constant/env': { APP_VERSION: '2.1.0-beta.2' },
        '@/扩展功能/软件更新/软件更新客户端': { updateRequest: () => assert.fail('过滤历史不应发出请求'), updateMessages: {} },
        '@/lib/release': releaseModule.exports, '@/扩展功能/主题/可见页面轮询': { useVisiblePolling() {} },
    };
    const source = readFileSync(new URL('../.运行/3100源/画布副本/web/src/hooks/use-version-check.ts', import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', '__APP_RELEASES__', code)(
        id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, module, module.exports, localReleases);
    const render = value => { status = value; stateIndex = 0; return module.exports.useVersionCheck(); };
    const stable = [localReleases[1], localReleases[3]];
    assert.deepEqual(render(null).releases, stable);
    for (const developerMode of [false, true, false, true]) {
        const value = render({ currentVersion: '2.1.0-beta.2', preferences: { developerMode },
            latest: { version: '2.1.0-beta.2', publishedAt: '2026-11-08T00:00:00Z', notes: '+ [新增] 在线Beta说明' } });
        assert.equal(value.currentVersion, '2.1.0-beta.2');
        assert.deepEqual(value.releases.map(item => item.version), (developerMode ? localReleases : stable).map(item => item.version));
        if (developerMode) assert.equal(value.releases[0].items[0].content, '在线Beta说明');
    }
    assert.deepEqual(localReleases, before, '切换只过滤展示，不删除离线Beta历史');
});
