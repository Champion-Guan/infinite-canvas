import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录, 上游目录 } from './公共.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 生成用户候选 } from './检查用户功能适配.mjs';
import * as policy from '../扩展功能/产品配置/用户已选功能.ts';

const 候选 = 生成用户候选();
const denied = { code: 'product_feature_disabled' };
const i18n = { t: key => key };
const jsx = (type, props) => ({ type, props });
const react = { useMemo: fn => fn(), useCallback: fn => fn, useEffect: () => {}, useState: value => [typeof value === 'function' ? value() : value, () => {}] };

function 加载(path, deps = {}, globals = {}) {
  // 仅在 VM 中替换 import.meta，合成开发插件环境不读实际环境或执行网络。
  const source = 候选.get(path).产物.replaceAll('import.meta.env', '__syntheticEnv');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  const module = { exports: {} };
  new vm.Script(outputText, { filename: path }).runInNewContext({
    module, exports: module.exports, __syntheticEnv: { VITE_DEV_PLUGINS: 'https://example.invalid/plugin.js' },
    require: key => {
      if (key === '@/guan/功能开关') return policy;
      if (key === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (Object.hasOwn(deps, key)) return deps[key];
      throw Error(`测试未声明依赖：${key}`);
    }, ...globals,
  });
  return module.exports;
}

function fakeCreate(init) {
  if (!init) return fakeCreate;
  let state;
  const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  const store = selector => selector(state);
  store.getState = () => state;
  store.setState = set;
  state = init(set, store.getState);
  return store;
}

test('关闭范围精确对应用户的32项选择，策略只读，未选业务不被扩展关闭', () => {
  const expected = [
    ...Array.from({ length: 7 }, (_, i) => `P0${i + 1}`),
    ...Array.from({ length: 4 }, (_, i) => `U0${i + 1}`), 'S07', 'S08',
    ...Array.from({ length: 7 }, (_, i) => `G0${i + 1}`),
    ...Array.from({ length: 8 }, (_, i) => `X0${i + 1}`),
    ...Array.from({ length: 4 }, (_, i) => `B0${i + 1}`),
  ];
  assert.deepEqual(policy.closedFeatureIds, expected);
  for (const value of [policy.closedFeatureIds, policy.productFeatures, policy.pageFeatures, policy.buildFeatures]) assert.ok(Object.isFrozen(value));
  for (const feature of [...Object.keys(policy.productFeatures), 'unknown']) assert.throws(() => policy.requireProductFeature(feature), denied);
  for (const value of ['home', 'image', 'video', 'canvas', 'assets', 'prompts', 'config', 'unknown']) assert.equal(policy.isPageEnabled(value), false);
  assert.ok(!policy.closedFeatureIds.includes('U05'));
  assert.ok(!policy.closedFeatureIds.includes('S03'));
});

test('关闭的旧配置页签回退渠道，未选配置页签保持', () => {
  for (const tab of ['webdav', 'local-proxy']) assert.equal(policy.resolveConfigTab(tab), 'channels');
  for (const tab of ['channels', 'preferences', 'prompt-sources', 'local-storage']) assert.equal(policy.resolveConfigTab(tab), tab);
  for (const key of ['home', 'docs', 'projects']) assert.equal(policy.isCanvasMenuEnabled(key), false);
  for (const key of ['new', 'delete', 'import', 'export', 'undo', 'redo']) assert.equal(policy.isCanvasMenuEnabled(key), true);
});

test('画布入口只选择最近已有记录，不排序改写数组、创建或删除项目', () => {
  const projects = Object.freeze([Object.freeze({ id: 'old', updatedAt: '2026-01-01' }), Object.freeze({ id: 'new', updatedAt: '2026-10-15' })]);
  assert.equal(policy.entryProjectId(projects), 'new');
  assert.equal(projects[0].id, 'old');
  assert.equal(policy.entryProjectId([]), null);
});

test('路由不再导入七类原版页面，旧地址回画布入口，工作区和404保留', () => {
  const { router } = 加载('web/src/router.tsx', {
    'react-router-dom': { createBrowserRouter: routes => routes, Outlet: 'Outlet', Navigate: 'Navigate' },
    '@/components/layout/analytics-tracker': { AnalyticsTracker: 'Analytics' },
    '@/guan/画布入口': { CanvasEntry: 'CanvasEntry' },
    '@/layouts/user-layout': 'UserLayout', '@/pages/canvas/project': 'CanvasProject', '@/pages/not-found': 'NotFound',
  });
  const children = router[0].children;
  assert.equal(children.find(route => route.path === '/').element.type, 'CanvasEntry');
  for (const path of ['/image', '/video', '/assets', '/prompts', '/canvas', '/config']) {
    const element = children.find(route => route.path === path).element;
    assert.equal(element.type, 'Navigate');
    assert.equal(element.props.to, '/');
  }
  assert.equal(children.find(route => route.path === '/canvas/:id').element.type, 'CanvasProject');
  assert.equal(router[1].path, '*');
  const { navigationTools } = 加载('web/src/constant/navigation-tools.ts', { 'lucide-react': {} });
  assert.equal(navigationTools.length, 0);
});

test('全局按钮保留渠道配置、作者GitHub标识和快捷键，不挂载关闭控件', () => {
  const { UserStatusActions } = 加载('web/src/components/layout/user-status-actions.tsx', {
    antd: { Tooltip: 'Tooltip' }, 'lucide-react': { Keyboard: 'Keyboard', Puzzle: 'Puzzle', Settings2: 'Settings2', BookOpen: 'BookOpen' },
    'react-i18next': { useTranslation: () => ({ t: key => key, i18n: { resolvedLanguage: 'zh-CN' } }) },
    '@/components/ui/animated-theme-toggler': { AnimatedThemeToggler: 'ThemeSwitch' },
    '@/components/layout/github-link': { GitHubLink: 'GitHubLink' },
    '@/components/layout/version-release-modal': { VersionReleaseModal: 'VersionModal' },
    '@/constant/env': { DOCS_URL: 'https://example.invalid/docs' }, '@/i18n': { changeAppLocale: () => {} },
    '@/lib/utils': { cn: (...args) => args.join(' ') }, '@/lib/canvas-theme': { canvasThemes: { dark: { node: { text: 'current-color' } } } },
    '@/stores/use-config-store': { useConfigStore: selector => selector({ openConfigDialog: () => {} }) },
    '@/stores/use-theme-store': { useThemeStore: selector => selector({ theme: 'dark', setTheme: () => {} }) },
  });
  const tree = UserStatusActions({ onOpenPlugins: () => {}, onOpenShortcuts: () => {} });
  const controls = tree.props.children.filter(Boolean);
  assert.deepEqual(Array.from(controls, node => node.type), ['button', 'GitHubLink', 'button']);
  assert.equal(controls[0].props['aria-label'], 'navigation.config');
  assert.equal(controls[2].props['aria-label'], 'topNav.shortcuts');
});

test('旧已启用插件、开发插件和本地扫描均不加载，不执行源码或写入缓存', async () => {
  let io = 0;
  const hit = () => { io++; throw Error('不应执行插件副作用'); };
  const module = 加载('web/src/lib/canvas/plugin-loader.ts', {
    '@/lib/canvas/node-registry': { registerNodeDefinitions: hit, unregisterPluginNodes: hit },
    '@/lib/canvas/plugin-runtime': { getPluginRuntime: hit },
    '@/stores/canvas/use-plugin-store': { usePluginStore: { getState: hit, persist: { rehydrate: hit } } }, '@/i18n': i18n,
  }, { fetch: hit, Blob: hit, URL: { createObjectURL: hit, revokeObjectURL: hit } });
  await module.ensurePluginsLoaded();
  await module.ensurePluginsLoaded();
  assert.throws(() => module.activatePlugin({ id: 'synthetic', nodes: [], setup: hit }), denied);
  await assert.rejects(module.installPluginFromUrl('https://example.invalid/plugin.js'), denied);
  await assert.rejects(module.updatePlugin({ url: 'https://example.invalid/plugin.js' }), denied);
  await assert.rejects(module.setPluginEnabled({ id: 'synthetic' }, true), denied);
  await assert.rejects(module.setPluginEnabled({ id: 'synthetic' }, false), denied);
  assert.throws(() => module.uninstallPlugin('synthetic'), denied);
  assert.equal(io, 0);
});

test('官方注册表和本地代理测试直接调用也在网络之前拒绝', async () => {
  let requests = 0;
  const fetch = () => { requests++; };
  const registry = 加载('web/src/lib/canvas/plugin-registry.ts', { '@/constant/env': { PLUGIN_REGISTRY_URL: 'https://example.invalid/registry.json' }, '@/i18n': i18n }, { fetch });
  const proxy = 加载('web/src/services/api/local-proxy.ts', { '@/i18n': i18n, '@/stores/use-config-store': { normalizeLocalProxyUrl: value => value } }, { fetch });
  await assert.rejects(registry.fetchOfficialPlugins(), denied);
  await assert.rejects(proxy.testLocalProxy('http://127.0.0.1:23210'), denied);
  assert.equal(requests, 0);
});

test('原作者版本检测手动及启动调用不联网，不展开已关闭面板', async () => {
  let requests = 0;
  let writes = 0;
  const effects = [];
  const module = 加载('web/src/hooks/use-version-check.ts', {
    react: { ...react, useEffect: fn => effects.push(fn), useState: value => [value, () => { writes++; }] },
    antd: { App: { useApp: () => ({ message: { success: () => {}, error: () => {} } }) } },
    'react-i18next': { useTranslation: () => i18n }, '@/constant/env': { APP_VERSION: '0.20.0' }, '@/lib/release': { parseChangelog: () => [] },
  }, { __APP_RELEASES__: [], fetch: () => { requests++; } });
  const hook = module.useVersionCheck();
  for (const effect of effects) effect();
  assert.equal(await hook.checkLatestRelease(true), false);
  hook.openReleaseModal();
  assert.equal(requests, 0);
  assert.equal(writes, 0);
});

test('关闭语言和主题切换不改写已有偏好', async () => {
  let writes = 0;
  const fakeI18n = { use() { return this; }, init() {}, changeLanguage() { writes++; } };
  const locale = 加载('web/src/i18n/index.ts', {
    i18next: fakeI18n, 'react-i18next': { initReactI18next: {} }, '@/i18n/locales/en-US': {}, '@/i18n/locales/zh-CN': {},
  }, { localStorage: { getItem: () => 'en-US', setItem: () => { writes++; } } });
  await locale.changeAppLocale('zh-CN');
  const theme = 加载('web/src/stores/use-theme-store.ts', { zustand: { create: fakeCreate }, 'zustand/middleware': { persist: init => init } });
  theme.useThemeStore.setState({ theme: 'light' });
  theme.useThemeStore.getState().setTheme('dark');
  assert.equal(theme.useThemeStore.getState().theme, 'light');
  assert.equal(writes, 0);
});

test('旧代理配置不继续转发，也不悄悄改成直连；未启用代理的请求保持原样', () => {
  const module = 加载('web/src/stores/use-config-store.ts', {
    react, zustand: { create: fakeCreate }, 'zustand/middleware': { persist: init => init }, nanoid: { nanoid: () => 'synthetic' }, '@/i18n': i18n,
  });
  const url = 'https://example.invalid/v1/images/generations';
  assert.equal(module.withLocalProxy(url), url);
  const config = { ...module.defaultConfig, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:23210' };
  module.useConfigStore.setState({ config });
  assert.throws(() => module.withLocalProxy(url), denied);
  assert.equal(module.useConfigStore.getState().config, config);
  assert.equal(module.useConfigStore.getState().config.proxyEnabled, true);
});

test('Agent、WebDAV、统计候选继续拒绝执行，模块使用同一用户策略', async () => {
  let io = 0;
  const hit = () => { io++; throw Error('禁用网络'); };
  const agent = 加载('web/src/services/api/canvas-agent.ts', { '@/i18n': i18n }, { fetch: hit });
  for (const method of ['postState', 'activateAgentClient', 'fetchAgentJson', 'discoverAgentConfig']) await assert.rejects(agent[method]('https://example.invalid', 'synthetic'), denied);
  const webdav = 加载('web/src/services/webdav-sync.ts', { '@/i18n': i18n, '@/stores/use-config-store': { withLocalProxy: hit } }, { fetch: hit, window: { setTimeout: hit }, Headers: hit });
  for (const method of ['testWebdavConnection', 'downloadWebdavFile', 'uploadWebdavFile']) await assert.rejects(webdav[method]({}, 'test', {}), denied);
  const analytics = 加载('web/src/lib/analytics.ts', { '@/constant/runtime-config': { ANALYTICS_GA4_ID: 'G-SYNTHETIC', ANALYTICS_BAIDU_ID: '0'.repeat(32) } }, { window: {}, document: { createElement: hit } });
  analytics.initAnalytics();
  analytics.trackPageview('/canvas/synthetic');
  assert.equal(io, 0);
});

test('不改业务数据库、媒体服务、生成API、内置节点、指令集或作者版权', () => {
  for (const path of ['web/src/stores/canvas/use-canvas-store.ts', 'web/src/services/image-storage.ts', 'web/src/services/file-storage.ts', 'web/src/components/canvas/nodes/builtin-nodes.tsx', 'web/src/services/api/image.ts', 'web/src/services/api/video.ts', 'web/src/services/api/audio.ts', 'web/src/lib/canvas/canvas-agent-ops.ts', 'LICENSE', 'web/src/components/layout/github-link.tsx']) assert.equal(候选.has(path), false, path);
  for (const [path, item] of 候选) {
    if (item.原文 !== null) assert.equal(item.原文, readFileSync(join(上游目录, path), 'utf8'));
  }
  const guard = readFileSync(join(根目录, '开发工具/检查运行副本.mjs'), 'utf8');
  assert.ok(guard.includes('用户已选功能批准.mjs'));
  assert.ok(guard.includes('检查批次状态'));
  assert.ok(guard.includes('模型编辑器语义.json'));
});
