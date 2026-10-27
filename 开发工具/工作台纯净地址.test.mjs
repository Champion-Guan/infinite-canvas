import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function load(name, dependencies = {}) {
    const source = readFileSync(new URL('../' + name, import.meta.url), 'utf8');
    const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', javascript)(id => dependencies[id] || require(id), module, module.exports);
    return module.exports;
}
const address = load('扩展功能/产品/工作台纯净地址.ts');
const { createRouterWindow } = load('扩展功能/本机存储/路由临时状态.ts', { '../产品/工作台纯净地址': address });
const { createBrowserRouter } = require('react-router-dom');

function browserWindow(initial = 'http://localhost:3001/', state = null) {
    const events = new EventTarget(), writes = [], counts = new Map();
    const entries = [{ url: new URL(initial), state: structuredClone(state) }]; let index = 0, attempts = 0;
    const source = {
        document: { createElement() { return {}; } },
        get location() { return entries[index].url; },
        addEventListener(type, listener) { assert.equal(this, source); events.addEventListener(type, listener); counts.set(type, (counts.get(type) || 0) + 1); },
        removeEventListener(type, listener) { assert.equal(this, source); events.removeEventListener(type, listener); counts.set(type, (counts.get(type) || 0) - 1); },
        dispatchEvent(event) { assert.equal(this, source); return events.dispatchEvent(event); },
    };
    const update = (operation, data, url) => {
        const next = { url: new URL(url ?? source.location.href, source.location.origin), state: structuredClone(data) };
        if (next.url.origin !== source.location.origin) throw new DOMException('cross origin', 'SecurityError');
        if (operation === 'push') { entries.splice(++index); entries.push(next); } else entries[index] = next;
        writes.push({ operation, url: next.url.href, state: next.state });
    };
    source.history = {
        get state() { return entries[index].state; }, get length() { return entries.length; },
        replaceState(data, _unused, url) { assert.equal(this, source.history); update('replace', data, url); },
        pushState(data, _unused, url) { assert.equal(this, source.history); update('push', data, url); },
        go(delta) { assert.equal(this, source.history); const next = index + delta; if (next >= 0 && next < entries.length) { index = next; events.dispatchEvent(new Event('popstate')); } },
        back() { this.go(-1); }, forward() { this.go(1); }, scrollRestoration: 'auto',
    };
    for (const key of ['sessionStorage', 'localStorage', 'indexedDB']) Object.defineProperty(source, key, { get() { attempts++; throw Error('禁止浏览器数据库'); } });
    return { source, writes, counts, attempts: () => attempts };
}
const routes = [{ path: '/', id: 'home' }, { path: '/canvas/:id', id: 'canvas' }, { path: '*', id: 'other' }];
function setup(browser) {
    const adapter = createRouterWindow(browser.source);
    return { adapter, router: createBrowserRouter(routes, { window: adapter, hydrationData: { loaderData: {} } }) };
}

test('旧画布链接移入官方 masked 状态，地址只显示根路径，保留原历史状态', () => {
    const browser = browserWindow('http://localhost:3001/canvas/legacy_product?mode=recent#section', { idx: 2, key: 'existing', usr: { draft: 'keep' } });
    const { router } = setup(browser);
    try {
        assert.equal(browser.source.location.href, 'http://localhost:3001/');
        assert.equal(router.state.location.pathname, '/canvas/legacy_product');
        assert.equal(router.state.location.search, '?mode=recent'); assert.equal(router.state.location.hash, '#section');
        assert.deepEqual(router.state.location.state, { draft: 'keep' });
        assert.equal(browser.source.history.state.idx, 2); assert.equal(browser.source.history.state.key, 'existing');
    } finally { router.dispose(); }
});

test('真实 React Router 连续切换胶囊不暴露 ID，替换导航不增加浏览器历史条目', async () => {
    const browser = browserWindow(), { router } = setup(browser);
    try {
        for (const id of ['product-a', 'legacy_product-b', '产品中文', 'product-a']) {
            await router.navigate('/canvas/' + encodeURIComponent(id), { replace: true, viewTransition: true });
            assert.equal(router.state.location.pathname, '/canvas/' + encodeURIComponent(id));
            assert.equal(browser.source.location.href, 'http://localhost:3001/');
            assert.equal(browser.source.history.state.masked.pathname, router.state.location.pathname);
        }
        assert.equal(browser.source.history.length, 1);
        assert.ok(browser.writes.every(write => write.url === 'http://localhost:3001/'));
    } finally { router.dispose(); }
});

test('根地址刷新恢复本标签页当前画布，多个标签页各自独立，不读取浏览器数据库', async () => {
    const first = browserWindow(), second = browserWindow();
    const one = setup(first), two = setup(second);
    await one.router.navigate('/canvas/first', { replace: true }); await two.router.navigate('/canvas/second', { replace: true });
    one.router.dispose(); two.router.dispose();
    const reloadedOne = setup(first), reloadedTwo = setup(second);
    try {
        assert.equal(reloadedOne.router.state.location.pathname, '/canvas/first');
        assert.equal(reloadedTwo.router.state.location.pathname, '/canvas/second');
        assert.equal(first.source.location.pathname, '/'); assert.equal(second.source.location.pathname, '/');
        assert.equal(first.attempts() + second.attempts(), 0);
    } finally { reloadedOne.router.dispose(); reloadedTwo.router.dispose(); }
});

test('浏览器前进后退保留真实内部路由，所有地址仍为 localhost 根地址', async () => {
    const browser = browserWindow(), { router } = setup(browser);
    try {
        await router.navigate('/canvas/first'); await router.navigate('/canvas/second');
        await router.navigate(-1); assert.equal(router.state.location.pathname, '/canvas/first');
        await router.navigate(1); assert.equal(router.state.location.pathname, '/canvas/second');
        assert.ok(browser.writes.every(write => write.url === 'http://localhost:3001/'));
    } finally { router.dispose(); }
});

test('保留减少动态效果以外的原生切换过渡，并只使用页内临时缓存', async () => {
    const browser = browserWindow(), { adapter, router } = setup(browser), transitions = [];
    const unsubscribe = router.subscribe((_state, options) => { if (options.viewTransitionOpts) transitions.push(options.viewTransitionOpts); });
    try {
        await router.navigate('/canvas/animated', { viewTransition: true });
        assert.equal(transitions.length, 1);
        adapter.dispatchEvent(new Event('pagehide'));
        assert.ok(adapter.sessionStorage.getItem('remix-router-transitions'));
        assert.equal(browser.attempts(), 0);
        assert.equal(adapter.window, adapter); assert.equal(adapter.self, adapter);
        assert.throws(() => adapter.localStorage, /不能打开/); assert.throws(() => adapter.indexedDB, /不能打开/);
    } finally { unsubscribe(); router.dispose(); }
    assert.equal(browser.counts.get('popstate'), 0); assert.equal(browser.counts.get('pagehide'), 0);
});

test('无 URL 的历史状态替换不会丢失内部位置，首页可恢复为空白入口', async () => {
    const browser = browserWindow('http://localhost:3001/canvas/start'), { adapter, router } = setup(browser);
    try {
        adapter.history.replaceState({ ...adapter.history.state, marker: 1 }, '');
        assert.equal(adapter.history.state.masked.pathname, '/canvas/start');
        await router.navigate('/', { replace: true }); assert.equal(router.state.location.pathname, '/');
        assert.equal(browser.source.location.href, 'http://localhost:3001/');
    } finally { router.dispose(); }
});

test('适配器拒绝跨来源历史导航，失败后保留原画布和根地址', () => {
    const browser = browserWindow('http://localhost:3001/canvas/start'), adapter = createRouterWindow(browser.source);
    assert.throws(() => adapter.history.pushState({}, '', 'https://evil.invalid/canvas/x'), { name: 'SecurityError' });
    assert.equal(browser.source.location.href, 'http://localhost:3001/');
    assert.equal(adapter.history.state.masked.pathname, '/canvas/start');
});
