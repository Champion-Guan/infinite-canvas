import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startupPreloadTags } from './首屏资源预载.mjs';
import { markWorkbenchStartup } from '../扩展功能/本机存储/启动计时.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { createStartupScreen } from '../扩展功能/本机存储/启动画面.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const chunk = (fileName, modules, imports = [], dynamicImports = []) => ({
  type: 'chunk', fileName, modules: Object.fromEntries(modules.map(name => [name, {}])),
  imports, dynamicImports, viteMetadata: { importedCss: new Set() },
});

test('预载只覆盖首屏静态图，动态设置和助手不提前下载，环与重复依赖只访问一次', () => {
  const bundle = {
    'entry.js': { ...chunk('entry.js', ['/src/boot.ts']), isEntry: true },
    'main.js': chunk('main.js', ['/src/main.tsx'], ['shared.js'], ['ui.js']),
    'ui.js': chunk('ui.js', ['/src/扩展功能/存储界面/SQLite应用入口.tsx'], ['shared.js'], ['settings.js', 'agent.js']),
    'shared.js': chunk('shared.js', [], ['ui.js', 'entry.js']),
    'settings.js': chunk('settings.js', []),
    'agent.js': chunk('agent.js', []),
  };
  bundle['ui.js'].viteMetadata.importedCss.add('ui.css');
  const tags = startupPreloadTags(bundle, '/');
  const scripts = tags.filter(tag => tag.attrs.rel === 'modulepreload').map(tag => tag.attrs.href).sort();
  assert.deepEqual(scripts, ['/main.js', '/shared.js', '/ui.js']);
  assert.deepEqual(tags.filter(tag => tag.attrs.as === 'style').map(tag => tag.attrs.href), ['/ui.css']);
  assert.deepEqual(startupPreloadTags({}, '/'), []);
  assert.ok(startupPreloadTags(bundle, '/app/').every(tag => tag.attrs.href.startsWith('/app/')));
});

function loadBridge(platform) {
  const source = readFileSync(new URL('../扩展功能/本机存储/上游浏览器存储桥.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (id === '../Excel画布/平台规则全局状态') return { globalPlatformRules: platform };
    if (id === '../软件更新/升级页面状态.mjs') return {};
    throw Error(id);
  }, module, module.exports);
  return module.exports;
}

test('状态和偏好同时读，完成两份验证后才发布，迁移复用已解析产品', async () => {
  let resolveState, resolvePrefs;
  const started = [], projects = [{ id: 'kept', nodes: [] }], migrations = [];
  const b = loadBridge({ initialize: async (_port, value) => migrations.push(value) });
  globalThis.window = { dispatchEvent() {}, addEventListener() {}, __guanSQLiteHost: { initialize: async () => ({
    retryPending() {}, subscribe() {}, getStatus: () => ({ state: 'idle' }),
    createInstance: ({ storeName }) => ({ iterate(callback) {
      started.push(storeName);
      return new Promise(resolve => {
        if (storeName === 'app_state') resolveState = () => { callback(JSON.stringify({ state: { projects } }), 'canvas'); resolve(); };
        else resolvePrefs = () => { callback('dark', 'theme'); resolve(); };
      });
    } }),
  }) } };
  try {
    const ready = b.initializeSQLiteApplication();
    await Promise.resolve();
    assert.deepEqual(started, ['app_state', 'preferences']);
    resolveState(); await Promise.resolve();
    assert.throws(() => b.sqliteStateStorage.getItem('canvas'), /尚未初始化/);
    resolvePrefs(); await ready;
    assert.deepEqual(migrations, [projects]);
    assert.equal(b.sqlitePreferences.getItem('theme'), 'dark');
  } finally { delete globalThis.window; }
});

test('计时只记录当前DOM阶段，重复渲染不覆盖首次时间', () => {
  const attributes = new Map();
  globalThis.document = { getElementById: () => ({
    hasAttribute: key => attributes.has(key), setAttribute: (key, value) => attributes.set(key, value),
  }) };
  try {
    markWorkbenchStartup('canvas-painted');
    const first = attributes.get('data-startup-canvas-painted');
    markWorkbenchStartup('canvas-painted');
    assert.equal(attributes.get('data-startup-canvas-painted'), first);
    assert.match(first, /^\d+\.\d$/);
  } finally { delete globalThis.document; }
});

test('并行连接仍等待会话和Fallback两份结果；任一失败均不加载界面', async () => {
  const source = readFileSync(new URL('../扩展功能/本机存储/工作台自动入口.mjs', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const fails of [false, true]) {
    const started = [];
    let resolveSession, resolveFallback, rejectFallback, opened = 0, closed = 0;
    const session = new Promise(resolve => { resolveSession = resolve; });
    const fallback = new Promise((resolve, reject) => { resolveFallback = resolve; rejectFallback = reject; });
    const dependencies = {
      '../故障切换/切换客户端.mjs': { createFallbackClient: () => ({ read: () => { started.push('fallback'); return fallback; } }) },
      './本机授权客户端.mjs': {},
      './页面授权生命周期.mjs': { bindPageAuthorization: () => () => {} },
      './续期数据客户端.mjs': { createRenewingDataClient: () => ({ ensureSession: () => { started.push('session'); return session; } }) },
      './可恢复应用存储.mjs': { createRecoverableApplicationStorage: () => ({ flush() {} }) },
      '../软件更新/自动更新重启.mjs': { bindAutomaticUpdateRestart() {} },
      './启动计时.mjs': { markWorkbenchStartup() {} },
      './开发构建自动刷新.mjs': { bindDevelopmentReload() {} },
      './启动画面.mjs': { createStartupScreen },
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
      assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id];
    }, module, module.exports);
    const element = () => ({ style: {}, setAttribute() {}, append() {}, addEventListener() {} });
    const document = {
      createElement: element, head: { append() {} }, body: { append() {} }, defaultView: {},
      querySelectorAll: () => [{ getAttribute: () => 'a'.repeat(64), removeAttribute() {}, remove() {} }],
    };
    const root = { ...element(), ownerDocument: document, childNodes: [], replaceChildren() {} };
    const entry = module.exports.mountAutomaticWorkbench({
      root, origin: 'http://localhost:3000', loadApplication: async () => { opened++; },
      authorize: async () => ({ host: { close: async () => { closed++; } } }),
    });
    await Promise.resolve();
    assert.deepEqual(started, ['session', 'fallback']);
    resolveSession(); await Promise.resolve();
    assert.equal(opened, 0);
    if (fails) rejectFallback(Error('只读配置断线'));
    else resolveFallback();
    assert.equal(await entry.ready, !fails);
    assert.equal(opened, fails ? 0 : 1);
    assert.equal(closed, fails ? 1 : 0);
    assert.equal(Boolean(document.defaultView.__guanSQLiteHost), !fails);
  }
});

test('同步普通值与异步媒体交替解码保留顺序、特殊键和末尾字段，坏值仍拒绝', async () => {
  const codec = createValueCodec({ client: {} });
  const blob = { mime: 'application/octet-stream', size: 0, id: null };
  const tree = ['object', [
    ['before', ['array', [['number', 1], ['blob', blob], ['number', 3]]]],
    ['__proto__', ['object', [['kept', ['boolean', true]]]]],
    ['after', ['string', '末尾数据']],
  ]];
  try {
    const value = await codec.decode(tree);
    assert.equal(value.before[0], 1); assert.ok(value.before[1] instanceof Blob); assert.equal(value.before[2], 3);
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    assert.deepEqual(value.__proto__, { kept: true });
    assert.equal(value.after, '末尾数据');
    await assert.rejects(codec.decode(['array', [['blob', blob], ['unknown', '坏值']]]), error => error.code === 'invalid_value');
    await assert.rejects(codec.decode(['object', [['x', ['number', 1]], ['x', ['number', 2]]]]), error => error.code === 'invalid_value');
  } finally { codec.close(); }
});

test('对象状态恢复跳过JSON往返，字符串兼容读取保留原值；真实编辑使初始对象失效', async () => {
  const value = { state: { projects: [{ id: 'object-state', nodes: [] }] }, version: 0 };
  const migrations = [];
  const b = loadBridge({ initialize: async (_port, projects) => migrations.push(projects) });
  let stringReads = 0, writes = 0;
  globalThis.window = { dispatchEvent() {}, addEventListener() {}, __guanSQLiteHost: { initialize: async () => ({
    retryPending() {}, subscribe() {}, getStatus: () => ({ state: 'idle' }), flush: async () => {},
    createInstance: ({ storeName }) => storeName === 'app_state' ? {
      iterate() { stringReads++; assert.fail('支持对象恢复时不走字符串读取'); },
      async iterateDecodedState(callback) { callback(value, 'canvas', 1); },
      async setItem() { writes++; },
    } : { async iterate() {} },
  }) } };
  try {
    await b.initializeSQLiteApplication();
    assert.equal(b.sqliteStateStorage.takeDecodedState('canvas'), value);
    assert.equal(b.sqliteStateStorage.takeDecodedState('canvas'), value);
    assert.equal(b.sqliteStateStorage.getItem('canvas'), JSON.stringify(value));
    assert.deepEqual(migrations, [value.state.projects]);
    assert.equal(stringReads, 0); assert.equal(writes, 0);
    await b.sqliteStateStorage.setItem('canvas', '{"state":{"projects":[]},"version":0}');
    assert.equal(b.sqliteStateStorage.takeDecodedState('canvas'), null);
    assert.equal(writes, 1);
  } finally { delete globalThis.window; }
});
