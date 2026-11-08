import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { 根目录 } from './公共.mjs';
import { 运行目录 } from './检查运行副本.mjs';
import { 启动主题候选, 路由窗口候选, 路由临时状态来源 } from './预审SQLite启动存储.mjs';

const require = createRequire(join(运行目录, 'web/package.json'));
const ts = require('typescript');
const source = readFileSync(join(根目录, 路由临时状态来源), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { createRouterWindow } = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));

function browserWindow() {
  const events = new EventTarget(), eventCounts = new Map();
  const source = {
    document: { createElement() { return {}; } },
    location: new URL('http://sqlite-test.invalid/'),
    addEventListener(type, listener) { assert.equal(this, source); events.addEventListener(type, listener); eventCounts.set(type, (eventCounts.get(type) ?? 0) + 1); },
    removeEventListener(type, listener) { assert.equal(this, source); events.removeEventListener(type, listener); eventCounts.set(type, eventCounts.get(type) - 1); },
    dispatchEvent(event) { assert.equal(this, source); return events.dispatchEvent(event); },
  };
  source.history = {
    state: null,
    replaceState(state, _unused, url) { this.state = state; if (url) source.location = new URL(url, source.location); },
    pushState(state, _unused, url) { this.state = state; if (url) source.location = new URL(url, source.location); },
    go() { throw Error('本单元不模拟浏览器历史栈'); },
  };
  let attempts = 0;
  for (const key of ['sessionStorage', 'localStorage', 'indexedDB']) Object.defineProperty(source, key, { get() { attempts++; throw Error('禁止浏览器持久化'); } });
  return { source, eventCounts, attempts: () => attempts };
}

test('主题启动脚本不再读取旧库，两种系统主题都正确，SQLite正式恢复逻辑不改', () => {
  const original = readFileSync(join(运行目录, 'web/index.html'), 'utf8');
  const script = text => text.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  let reads = 0;
  const localStorage = { getItem() { reads++; throw Error('禁止'); } };
  runInNewContext(script(original), { localStorage });
  assert.equal(reads, 1);
  for (const dark of [true, false]) {
    const toggles = [], root = { classList: { toggle(...args) { toggles.push(args); } }, style: {} };
    runInNewContext(script(启动主题候选(original)), { localStorage, window: { matchMedia: () => ({ matches: dark }) }, document: { documentElement: root } });
    assert.deepEqual(toggles, [['dark', dark]]); assert.equal(root.style.colorScheme, dark ? 'dark' : 'light');
  }
  assert.equal(reads, 1);
  assert.throws(() => 启动主题候选(启动主题候选(original)), /锚点/);
});

test('路由只用官方window参数，精确锚点漂移会停止', () => {
  const original = readFileSync(join(运行目录, 'web/src/router.tsx'), 'utf8');
  const candidate = 路由窗口候选(original);
  assert.match(candidate, /window: createRouterWindow\(window\)/);
  assert.equal(candidate.replace('import { createRouterWindow } from "@/guan/路由临时状态";\n', '').replace('], { window: createRouterWindow(window) });', ']);'), original);
  assert.throws(() => 路由窗口候选(candidate), /锚点/);
});

test('路由页内Storage接口、实例隔离、原生方法绑定与真实history/location保留', () => {
  const browser = browserWindow(), one = createRouterWindow(browser.source), two = createRouterWindow(browser.source);
  one.sessionStorage.setItem('a', 12); one.sessionStorage.setItem('b', 'text');
  assert.equal(one.sessionStorage.getItem('a'), '12'); assert.equal(one.sessionStorage.length, 2);
  assert.equal(one.sessionStorage.key(0), 'a'); assert.equal(one.sessionStorage.key(7), null);
  assert.equal(two.sessionStorage.getItem('a'), null);
  one.sessionStorage.removeItem('a'); assert.equal(one.sessionStorage.getItem('a'), null);
  one.sessionStorage.clear(); assert.equal(one.sessionStorage.length, 0);
  assert.equal(one.window, one); assert.equal(one.self, one);
  assert.equal(one.history, browser.source.history); assert.equal(one.location, browser.source.location);
  assert.equal(one.addEventListener, one.addEventListener);
  const listener = () => {}; one.addEventListener('test', listener); one.removeEventListener('test', listener);
  assert.equal(browser.eventCounts.get('test'), 0); assert.equal(browser.attempts(), 0);
  assert.throws(() => one.localStorage, /不能打开/); assert.throws(() => one.indexedDB, /不能打开/);
  assert.equal(Reflect.set(one, 'sessionStorage', {}), false); assert.equal(browser.attempts(), 0);
});

test('真实React Router初始化/导航/pagehide缓存及dispose不访问浏览器数据库', async () => {
  const { createBrowserRouter } = require('react-router-dom');
  const browser = browserWindow(), adapter = createRouterWindow(browser.source);
  const router = createBrowserRouter([{ path: '/', id: 'home' }, { path: '/canvas/:id', id: 'canvas' }], { window: adapter, hydrationData: { loaderData: {} } });
  try {
    assert.equal(router.state.location.pathname, '/');
    await router.navigate('/canvas/synthetic', { viewTransition: true });
    assert.equal(router.state.location.pathname, '/canvas/synthetic');
    assert.equal(browser.source.location.pathname, '/canvas/synthetic');
    adapter.dispatchEvent(new Event('pagehide'));
    assert.ok(adapter.sessionStorage.getItem('remix-router-transitions'));
    assert.equal(browser.attempts(), 0);
  } finally { router.dispose(); }
  assert.equal(browser.eventCounts.get('pagehide'), 0); assert.equal(browser.eventCounts.get('popstate'), 0);
});
