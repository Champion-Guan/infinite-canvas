import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 生成请求转发候选 } from './预审请求转发恢复.mjs';
import { 运行目录, 哈希 } from './检查运行副本.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 策略路径, 替换 } from '../上游适配/请求转发恢复.mjs';
import { 请求转发前态指纹 } from '../上游适配/请求转发恢复批准.mjs';

const files = 生成请求转发候选();
const text = path => files.get(path)?.产物 ?? readFileSync(join(运行目录, path), 'utf8');
const jsx = (type, props) => ({ type, props });
const react = { useMemo: fn => fn(), useEffect() {}, useRef: () => ({ current: null }), useState: value => [typeof value === 'function' ? value() : value, () => {}] };
function load(path, deps = {}, globals = {}, source = text(path)) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  const module = { exports: {} };
  new vm.Script(outputText, { filename: path }).runInNewContext({ module, exports: module.exports,
    require: key => {
      if (key === 'react') return react;
      if (key === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (key === '@/i18n') return { t: key => key };
      if (Object.hasOwn(deps, key)) return deps[key];
      throw Error('测试未声明依赖：' + key);
    }, ...globals,
  });
  return module.exports;
}
const policy = load(策略路径);
const business = load('web/src/guan/脚本与提示词来源.ts');
const auxiliary = load('web/src/guan/精简与离线策略.ts');
function fakeCreate(init) {
  if (!init) return fakeCreate;
  let state;
  const store = selector => selector(state);
  store.getState = () => state;
  store.setState = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  state = init(store.setState, store.getState);
  return store;
}
function configStore() {
  return load('web/src/stores/use-config-store.ts', {
    '@/guan/功能开关': policy, '@/guan/脚本与提示词来源': business, '@/guan/精简与离线策略': auxiliary,
    zustand: { create: fakeCreate }, 'zustand/middleware': { persist: init => init }, nanoid: { nanoid: () => 'synthetic' },
  });
}

test('候选只有自有策略1文件2处差异，当前副本及批准快照未改变', () => {
  assert.equal(files.size, 1);
  assert.deepEqual([...files.keys()], [策略路径]);
  const { 原文, 产物 } = files.get(策略路径);
  let expected = 原文;
  for (const [before, after] of 替换) expected = expected.replace(before, after);
  assert.equal(产物, expected);
  assert.equal(请求转发前态指纹(运行目录, 策略路径), 哈希(原文));
  const manifest = JSON.parse(readFileSync(new URL('../上游适配/待审查/保留顶栏主题与单测试来源.json', import.meta.url)));
  assert.equal(哈希(原文), manifest.文件.find(item => item.文件 === 策略路径).候选SHA256);
});

test('只恢复S07，其他关闭项与脚本/插件/Agent/WebDAV策略不变', () => {
  assert.equal(policy.productFeatures.localProxy, true);
  assert.equal(Object.isFrozen(policy.productFeatures), true);
  assert.doesNotThrow(() => policy.requireProductFeature('localProxy'));
  assert.equal(policy.closedFeatureIds.includes('S07'), false);
  for (const feature of Object.keys(policy.productFeatures).filter(key => key !== 'localProxy')) assert.throws(() => policy.requireProductFeature(feature), { code: 'product_feature_disabled' });
  const before = load(策略路径, {}, {}, files.get(策略路径).原文);
  assert.equal(JSON.stringify(before.pageFeatures), JSON.stringify(policy.pageFeatures));
  assert.equal(JSON.stringify(before.buildFeatures), JSON.stringify(policy.buildFeatures));
  assert.equal(JSON.stringify(before.closedFeatureIds.filter(id => id !== 'S07')), JSON.stringify(policy.closedFeatureIds));
  for (const feature of Object.keys(before.productFeatures).filter(key => key !== 'localProxy')) assert.equal(policy.productFeatures[feature], before.productFeatures[feature]);
  for (const feature of ['modelScripts', 'promptRefresh', 'promptSourceCreate', 'promptRefreshAll']) assert.throws(() => business.requireBusinessFeature(feature), { code: 'product_feature_disabled' });
});

test('原配置页实际渲染恢复本地代理页签，不恢复WebDAV或主题偏好区块', () => {
  const api = configStore();
  const widget = name => ({ [name]: name });
  const { AppConfigPanel } = load('web/src/components/layout/app-config-modal.tsx', {
    '@/guan/功能开关': policy, '@/guan/脚本与提示词来源': business,
    antd: { App: { useApp: () => ({ message: {} }) }, Button: 'Button', Form: { Item: 'FormItem' }, Input: { TextArea: 'TextArea' }, Modal: 'Modal', Progress: 'Progress', Radio: { Group: 'RadioGroup' }, Select: 'Select', Switch: 'Switch', Tabs: 'Tabs' },
    'lucide-react': {}, 'react-i18next': { useTranslation: () => ({ t: key => key, i18n: { resolvedLanguage: 'zh-CN' } }) },
    '@/components/model-picker': widget('ModelPicker'), '@/components/video-settings-panel': { videoResolutionOptions: [] },
    '@/components/layout/channel-editor-drawer': widget('ChannelEditorDrawer'), '@/components/layout/config-local-proxy': widget('ConfigLocalProxy'),
    '@/components/layout/config-prompt-sources': widget('ConfigPromptSources'), '@/components/layout/config-local-storage': widget('ConfigLocalStorage'),
    '@/services/config-file': {}, '@/services/app-sync': {}, '@/services/webdav-sync': {},
    '@/lib/audio-generation': { audioFormatOptions: [], audioVoiceOptions: [] },
    '@/lib/media-size': { mediaScaleOptions: [], inferMediaScale: () => 'auto', parseVideoResolution: () => '720' },
    '@/stores/use-config-store': api,
  });
  const tree = AppConfigPanel({ initialTab: 'local-proxy' });
  const tabs = tree.props.children.find(node => node?.type === 'Tabs');
  assert.equal(tabs.props.activeKey, 'local-proxy');
  assert.ok(tabs.props.items.some(item => item.key === 'local-proxy' && item.children.type === 'ConfigLocalProxy'));
  assert.equal(tabs.props.items.some(item => item.key === 'webdav'), false);
  assert.equal(text('web/src/components/layout/app-config-modal.tsx').includes('ThemePreference'), false);
  assert.equal(policy.resolveConfigTab('webdav'), 'channels');
});

test('恢复能力不强制打开用户开关，不修改默认地址和持久化键', () => {
  const api = configStore();
  assert.equal(api.defaultConfig.proxyEnabled, false);
  assert.equal(api.defaultConfig.proxyUrl, 'http://127.0.0.1:23210');
  assert.equal(api.CONFIG_STORE_KEY, 'infinite-canvas:ai_config_store');
  assert.equal(api.withLocalProxy('https://provider.example.invalid/v1/models'), 'https://provider.example.invalid/v1/models');
});

test('原store启用时正确包装URL，不重复包装，不改数据URL或用户配置', () => {
  const api = configStore();
  const config = { ...api.defaultConfig, proxyEnabled: true, proxyUrl: '127.0.0.1:23211/' };
  api.useConfigStore.setState({ config });
  const before = JSON.stringify(config);
  assert.equal(api.withLocalProxy('https://provider.example.invalid/v1/models'), 'http://127.0.0.1:23211/https://provider.example.invalid/v1/models');
  assert.equal(api.withLocalProxy('http://127.0.0.1:23211/https://provider.example.invalid/v1/models'), 'http://127.0.0.1:23211/https://provider.example.invalid/v1/models');
  for (const url of ['data:image/png;base64,synthetic', 'blob:synthetic', '/local-path']) assert.equal(api.withLocalProxy(url), url);
  assert.equal(api.buildApiUrl('https://provider.example.invalid/v1/', '/images/generations'), 'http://127.0.0.1:23211/https://provider.example.invalid/v1/images/generations');
  assert.equal(JSON.stringify(config), before);
  api.useConfigStore.getState().openConfigDialog(false, 'local-proxy');
  assert.equal(api.useConfigStore.getState().configTab, 'local-proxy');
});

test('原连接测试只在主动调用时请求，合成成功/无效响应/连接失败均可反馈', async () => {
  const api = configStore();
  let requests = 0;
  let mode = 'ok';
  const proxy = load('web/src/services/api/local-proxy.ts', { '@/guan/功能开关': policy, '@/stores/use-config-store': api }, {
    fetch: async (url, options) => {
      requests++;
      assert.equal(url, 'http://127.0.0.1:23211/');
      assert.equal(options.cache, 'no-store');
      if (mode === 'offline') throw Error('synthetic-offline');
      return { ok: mode === 'ok', json: async () => ({ proxy: 'synthetic-proxy', version: '0.1.0' }) };
    },
  });
  assert.equal(requests, 0);
  assert.equal(await proxy.testLocalProxy('127.0.0.1:23211/'), 'synthetic-proxy v0.1.0');
  mode = 'bad'; await assert.rejects(proxy.testLocalProxy('127.0.0.1:23211'), /config.proxy.unreachable/);
  mode = 'offline'; await assert.rejects(proxy.testLocalProxy('127.0.0.1:23211'), /synthetic-offline/);
  await assert.rejects(proxy.testLocalProxy(''), /config.proxy.missingUrl/);
  assert.equal(requests, 3);
});

test('原转发界面/生成服务/画布数据未列入候选，不能通过预审启动或应用', () => {
  for (const path of ['canvas-proxy/index.js', 'web/src/components/layout/config-local-proxy.tsx', 'web/src/stores/use-config-store.ts', 'web/src/services/api/local-proxy.ts', 'web/src/services/api/image.ts', 'web/src/services/api/video.ts', 'web/src/services/api/audio.ts', 'web/src/stores/canvas/use-canvas-store.ts']) assert.equal(files.has(path), false);
  const tool = readFileSync(new URL('./预审请求转发恢复.mjs', import.meta.url), 'utf8');
  assert.ok(tool.includes('仅供预审，不能应用或启动请求转发'));
  assert.equal(/\.listen\s*\(|\bspawn\s*\(/.test(tool), false);
});
