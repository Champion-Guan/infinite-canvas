import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 生成全局界面候选, 生成品牌资源差异 } from './预审全局界面恢复.mjs';
import { 生成脚本来源候选 } from './预审脚本与提示词来源.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 读取品牌资源 } from './导入品牌原样资源.mjs';
import { 品牌资源 } from '../上游适配/全局顶栏主题品牌恢复.mjs';
import { 上游目录 } from './公共.mjs';

const files = 生成全局界面候选();
const previous = 生成脚本来源候选();
const source = { id: 'synthetic-source', name: '测试来源', url: 'https://source.example.invalid/prompts.json', homepage: 'https://source.example.invalid', enabled: true, builtIn: false };

function load(path, deps = {}, globals = {}) {
  // 历史批次应使用锁定上游的未改模块，不随最新运行副本的后继主题实现漂移。
  const text = files.get(path)?.产物 ?? previous.get(path)?.产物 ?? readFileSync(join(上游目录, path), 'utf8');
  const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  const module = { exports: {} };
  new vm.Script(outputText, { filename: path }).runInNewContext({
    module, exports: module.exports, URL, DOMException,
    require: name => {
      if (name === '@/guan/功能开关') return productPolicy;
      if (name === '@/guan/脚本与提示词来源') return sourcePolicy;
      if (name === '@/i18n') return { t: key => key };
      if (Object.hasOwn(deps, name)) return deps[name];
      throw Error('未声明测试依赖：' + name);
    }, ...globals,
  });
  return module.exports;
}

const productPolicy = load('web/src/guan/功能开关.ts');
const sourcePolicy = load('web/src/guan/脚本与提示词来源.ts');
const jsxRuntime = { Fragment: Symbol('fragment'), jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];

function fakeCreate(init) {
  if (!init) return fakeCreate;
  let state;
  const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  const store = selector => selector(state);
  store.getState = () => state;
  state = init(set, store.getState);
  return store;
}

test('仅恢复U02/R02/R03，脚本/Agent/插件/代理/隐藏页面不顺带恢复', () => {
  assert.equal(files.size, 8);
  assert.equal(productPolicy.productFeatures.themeSwitch, true);
  assert.equal(productPolicy.closedFeatureIds.includes('U02'), false);
  for (const [key, value] of Object.entries(productPolicy.productFeatures)) if (key !== 'themeSwitch') assert.equal(value, false);
  assert.equal(Object.values(productPolicy.pageFeatures).every(value => value === false), true);
  assert.equal(sourcePolicy.businessFeatures.promptSources, true);
  assert.equal(sourcePolicy.businessFeatures.promptRefresh, true);
  assert.equal(sourcePolicy.businessFeatures.modelScripts, false);
  assert.equal(sourcePolicy.resolveBusinessConfigTab('prompt-sources'), 'prompt-sources');
  assert.throws(() => sourcePolicy.requireBusinessFeature('modelScripts'), { code: 'product_feature_disabled' });
});

test('所有工作台路由和404都使用同一顶栏，不再切回原作者顶栏', () => {
  const Header = Symbol('legacy-header');
  const api = load('web/src/layouts/user-layout.tsx', {
    'react/jsx-runtime': jsxRuntime,
    '@/guan/旧版首页顶栏': { LegacyHomeChrome: Header },
    '@/components/agent/agent-panel': { AgentPanel: Symbol('agent') },
  });
  const nodes = flatten(api.default({ children: 'synthetic-page' }));
  assert.equal(nodes.filter(node => node.type === Header).length, 1);
  assert.ok(!files.get('web/src/layouts/user-layout.tsx').产物.includes('useLocation'));
  assert.ok(files.get('web/src/router.tsx').产物.includes('element: <UserLayout><NotFound /></UserLayout>'));
  assert.ok(!files.get('web/src/pages/not-found/index.tsx').产物.includes('h-dvh'));
  assert.equal(files.has('web/src/pages/canvas/project.tsx'), false);
});

test('主题按钮不再禁用并接入真正主题store，旧图标及84px样式不重画，设置仅挂载一份', () => {
  const themeStore = load('web/src/stores/use-theme-store.ts', { zustand: { create: fakeCreate }, 'zustand/middleware': { persist: init => init } }).useThemeStore;
  const Toggle = Symbol('theme-toggle'), Modal = Symbol('config-modal');
  const api = load('web/src/guan/旧版首页顶栏.tsx', {
    'react/jsx-runtime': jsxRuntime,
    'react-router-dom': { useNavigate: () => () => {} },
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@/components/layout/app-config-modal': { AppConfigModal: Modal },
    '@/components/ui/animated-theme-toggler': { AnimatedThemeToggler: Toggle },
    '@/stores/canvas/use-canvas-store': { useCanvasStore: select => select({ createProject() {} }) },
    '@/stores/use-config-store': { useConfigStore: select => select({ openConfigDialog() {} }) },
    '@/stores/use-theme-store': { useThemeStore: themeStore },
    './旧版顶栏.module.css': {},
  });
  const read = () => flatten(api.LegacyHomeChrome());
  assert.equal(read().filter(node => node.type === Modal).length, 1);
  let toggle = read().find(node => node.type === Toggle);
  assert.equal(toggle.props.disabled, undefined);
  assert.equal(toggle.props['aria-label'], '切换浅色主题');
  assert.equal(toggle.props.duration, 400);
  assert.equal(toggle.props.variant, 'circle');
  toggle.props.onThemeChange('light');
  assert.equal(themeStore.getState().theme, 'light');
  toggle = read().find(node => node.type === Toggle);
  assert.equal(toggle.props['aria-label'], '切换深色主题');
  toggle.props.onThemeChange('dark');
  assert.equal(themeStore.getState().theme, 'dark');
  assert.equal(files.has('web/src/guan/旧版顶栏.module.css'), false);
});

function promptApi({ fail = false } = {}) {
  const cache = new Map();
  let requests = 0;
  const store = { sources: [source], schedule: { intervalMinutes: 30, lastFetchedAt: '' } };
  const runtime = load('web/src/services/api/prompt-source-runtime.ts', {}, {
    fetch: async url => {
      assert.equal(url, source.url);
      requests++;
      if (fail) throw Error('synthetic-offline');
      return { ok: true, json: async () => [{ id: 'prompt', title: '测试标题', prompt: '尺寸展示', tags: ['尺寸'] }] };
    },
  });
  const api = load('web/src/services/api/prompts.ts', {
    localforage: { createInstance: () => ({ getItem: async key => cache.get(key) ?? null, setItem: async (key, value) => { cache.set(key, value); } }) },
    './prompt-source-runtime': runtime,
    '@/stores/use-prompt-source-store': { usePromptSourceStore: { getState: () => store } },
  });
  return { api, cache, count: () => requests };
}

test('手动刷新真的读取JSON并写入合成缓存；同一来源并发请求去重', async () => {
  const { api, cache, count } = promptApi();
  const [a, b] = await Promise.all([api.refreshSource(source.id), api.refreshSource(source.id)]);
  assert.equal(a.success, true); assert.equal(b.success, true);
  assert.equal(a.count, 1); assert.equal(count(), 1);
  assert.equal(cache.get('prompt-source:' + source.id).items[0].prompt, '尺寸展示');
  const due = await api.refreshDueSources(30 * 60_000);
  assert.equal(due.results.length, 0);
  assert.equal(count(), 1);
});

test('联网失败仍保留旧提示词缓存，不清空来源与旧数据', async () => {
  const { api, cache } = promptApi({ fail: true });
  cache.set('prompt-source:' + source.id, { items: [{ id: 'old', title: '保留', prompt: '保留原提示词', tags: [] }], count: 1, fetchedAt: 1, lastSuccessAt: '2020-01-01T00:00:00Z', lastError: '', signature: 'stale' });
  await assert.rejects(api.refreshSource(source.id));
  const saved = cache.get('prompt-source:' + source.id);
  assert.equal(saved.items[0].prompt, '保留原提示词');
  assert.equal(saved.lastSuccessAt, '2020-01-01T00:00:00Z');
  assert.ok(saved.lastError);
});

test('自动刷新恢复启动检查与分钟计时器；尊重关闭间隔并清理卸载定时器', async () => {
  for (const intervalMinutes of [0, 30]) {
    let effect, refreshes = 0, timer, cleared;
    const api = load('web/src/hooks/use-prompt-source-scheduler.ts', {
      react: { useEffect: fn => { effect = fn; } },
      '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
      '@/services/api/prompts': { refreshDueSources: async age => { assert.equal(age, intervalMinutes * 60_000); refreshes++; return { results: [] }; } },
      '@/stores/use-prompt-source-store': { usePromptSourceStore: Object.assign(select => select({ schedule: { intervalMinutes } }), { getState: () => ({ updateSchedule() {} }) }) },
    }, { window: { setInterval: (callback, delay) => { timer = { callback, delay }; return 7; }, clearInterval: id => { cleared = id; } } });
    api.usePromptSourceScheduler();
    const cleanup = effect();
    await new Promise(resolve => setImmediate(resolve));
    if (!intervalMinutes) {
      assert.equal(refreshes, 0); assert.equal(timer, undefined); assert.equal(cleanup, undefined);
    } else {
      assert.equal(refreshes, 1); assert.equal(timer.delay, 60_000);
      await timer.callback();
      assert.equal(refreshes, 2);
      cleanup(); assert.equal(cleared, 7);
    }
  }
});

test('提示词来源增删改、启停和间隔恢复；不改持久化键、不丢旧配置', () => {
  let options;
  const api = load('web/src/stores/use-prompt-source-store.ts', {
    zustand: { create: fakeCreate },
    'zustand/middleware': { persist: (init, config) => { options = config; return init; } },
    '@/services/api/prompt-source-presets': { DEFAULT_PROMPT_SOURCES: [], createPromptSource: value => value || { ...source } },
  });
  const local = api.usePromptSourceStore;
  assert.equal(options.name, 'infinite-canvas:prompt_source_store_v2');
  const draft = local.getState().addSource();
  local.getState().saveSource(draft);
  assert.equal(local.getState().sources.length, 1);
  local.getState().saveSource({ ...draft, name: '已改名' });
  assert.equal(local.getState().sources[0].name, '已改名');
  local.getState().toggleSource(draft.id, false);
  assert.equal(local.getState().sources[0].enabled, false);
  local.getState().updateSchedule('intervalMinutes', 60);
  assert.equal(local.getState().schedule.intervalMinutes, 60);
  const saved = { sources: [draft], schedule: { intervalMinutes: 360, lastFetchedAt: '' } };
  assert.equal(options.merge(saved, local.getState()).sources[0].id, draft.id);
  local.getState().removeSource(draft.id);
  assert.equal(local.getState().sources.length, 0);
});

test('恢复提示词联网不放开模型自定义脚本执行', async () => {
  let sideEffects = 0;
  const denied = () => { sideEffects++; throw Error('不应执行'); };
  const api = load('web/src/services/api/model-plugin.ts', {
    axios: { request: denied }, '@/stores/use-config-store': { buildApiUrl: denied, withLocalProxy: denied },
  }, { Function: denied, fetch: denied });
  await assert.rejects(api.runModelPlugin({ capability: 'image', script: 'return []', config: {} }), { code: 'product_feature_disabled' });
  assert.equal(sideEffects, 0);
});

test('HTML和React标题一致，紫色G逐字节复制且差异包含精确二进制', () => {
  assert.ok(files.get('web/index.html').产物.includes('<title>AI生图工作台</title>'));
  assert.ok(files.get('web/index.html').产物.includes('/guan/brand/favicon.png'));
  assert.ok(files.get('web/src/components/layout/app-providers.tsx').产物.includes('document.title = "AI生图工作台";'));
  assert.equal(哈希(读取品牌资源()), 品牌资源.SHA256);
  assert.ok(生成品牌资源差异().includes('GIT binary patch'));
  assert.equal(files.has('web/public/logo.svg'), false);
  assert.equal(files.has('LICENSE'), false);
});
