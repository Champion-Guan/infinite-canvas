import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 生成精简主题候选 } from './预审精简离线与三态主题.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 运行目录 } from './检查运行副本.mjs';

const files = 生成精简主题候选();
const denied = { code: 'product_feature_disabled' };
const source = { id: 'synthetic-local-cache', name: '合成缓存', url: 'https://source.example.invalid/prompts.json', homepage: 'https://source.example.invalid', enabled: true };
const sourceState = { sources: [source], schedule: { intervalMinutes: 30 } };
const jsxRuntime = { Fragment: Symbol('fragment'), jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
const i18n = { t: key => key };
let productPolicy, sourcePolicy;
function loadText(text, deps = {}, globals = {}) {
  const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  const module = { exports: {} };
  new vm.Script(outputText).runInNewContext({ module, exports: module.exports, URL, DOMException,
    require: name => {
      if (name === '@/guan/精简与离线策略') return productPolicy;
      if (name === '@/guan/脚本与提示词来源') return sourcePolicy;
      if (name === '@/i18n') return i18n;
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (Object.hasOwn(deps, name)) return deps[name];
      throw Error('测试未声明依赖：' + name);
    }, ...globals });
  return module.exports;
}
const load = (path, deps, globals) => loadText(files.get(path).产物, deps, globals);
productPolicy = load('web/src/guan/精简与离线策略.ts');
sourcePolicy = load('web/src/guan/脚本与提示词来源.ts');

function fakeCreate(init) {
  if (!init) return fakeCreate;
  let state;
  const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  const store = select => select(state);
  store.getState = () => state;
  state = init(set, store.getState);
  return store;
}
function namedFunction(text, name) {
  const src = ts.createSourceFile('file.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = src.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, '没有找到函数：' + name);
  return node.getText(src);
}

test('仅图片和文本新生成可用；未知模式也拒绝，策略冻结', () => {
  assert.equal(Object.isFrozen(productPolicy.auxiliaryFeatures), true);
  for (const mode of ['image', 'text']) assert.equal(productPolicy.isGenerationModeEnabled(mode), true);
  for (const mode of ['video', 'audio', 'unknown']) assert.throws(() => productPolicy.requireGenerationMode(mode), denied);
  for (const key of Object.keys(productPolicy.auxiliaryFeatures)) assert.throws(() => productPolicy.requireAuxiliaryFeature(key), denied);
  assert.equal(sourcePolicy.businessFeatures.promptSources, true);
  assert.equal(sourcePolicy.businessFeatures.promptRefresh, false);
  assert.equal(sourcePolicy.businessFeatures.modelScripts, false);
});

test('网址凭据不读取、不导入；不把任意URL内容打印到提示中', () => {
  let scheduled = 0;
  const root = load('web/src/components/layout/client-root-init.tsx', {
    '@/hooks/use-prompt-source-scheduler': { usePromptSourceScheduler: () => scheduled++ },
  }, { window: { get location() { throw Error('不应读取网址'); } } });
  assert.equal(root.ClientRootInit({ children: 'fixture' }).props.children, 'fixture');
  assert.equal(scheduled, 1);
  assert.ok(files.get('web/src/stores/use-config-store.ts').产物.includes('importChannelCredentials: (input) => {\n                requireAuxiliaryFeature("urlCredentials");'));
});

test('直接调用网址导入store方法也不读取或修改渠道', () => {
  const text = files.get('web/src/stores/use-config-store.ts').产物;
  const src = ts.createSourceFile('store.ts', text, ts.ScriptTarget.Latest, true);
  let arrow;
  const visit = node => {
    if (ts.isPropertyAssignment(node) && node.name.getText(src) === 'importChannelCredentials') arrow = node.initializer.getText(src);
    ts.forEachChild(node, visit);
  };
  visit(src); assert.ok(arrow);
  let writes = 0;
  const hit = () => { writes++; throw Error('不能接触渠道'); };
  const api = loadText('export const run = ' + arrow, {}, { requireAuxiliaryFeature: productPolicy.requireAuxiliaryFeature, get: hit, set: hit, upsertChannelCredentials: hit });
  assert.throws(() => api.run({ baseUrl: 'https://example.invalid', apiKey: 'synthetic-not-a-real-key' }), denied);
  assert.equal(writes, 0);
});

test('语音/视频API在解析配置、上传引用和网络请求前拒绝', async () => {
  let effects = 0;
  const hit = () => { effects++; throw Error('不允许生成副作用'); };
  const common = {
    axios: { post: hit, get: hit }, nanoid: { nanoid: hit },
    '@/lib/audio-generation': {}, '@/services/file-storage': {}, '@/services/image-storage': {},
    '@/lib/image-utils': {}, '@/lib/media-size': {},
    '@/stores/use-config-store': { resolveModelRequestConfig: hit }, './model-plugin': { runModelPlugin: hit },
  };
  const config = { model: 'synthetic-not-a-real-model' };
  const before = JSON.stringify(config);
  const audio = load('web/src/services/api/audio.ts', common);
  const video = load('web/src/services/api/video.ts', common);
  await assert.rejects(audio.requestAudioGeneration(config, 'fixture'), denied);
  await assert.rejects(video.createVideoGenerationTask(config, 'fixture'), denied);
  await assert.rejects(video.requestVideoGeneration(config, 'fixture'), denied);
  assert.equal(effects, 0);
  assert.equal(JSON.stringify(config), before);
});

test('已有视频的轮询、等待、结果保存函数保持逐字不变', () => {
  const file = files.get('web/src/services/api/video.ts');
  for (const name of ['pollVideoGenerationTask', 'waitForVideoGenerationTask', 'storeGeneratedVideo']) assert.equal(namedFunction(file.产物, name), namedFunction(file.原文, name));
  for (const path of ['web/src/components/canvas/canvas-node.tsx', 'web/src/services/file-storage.ts', 'web/src/services/config-file.ts', 'web/src/stores/canvas/use-canvas-store.ts']) assert.equal(files.has(path), false);
});

test('画布触发器在创建节点、改变loading和引用读取前停止已关闭模式', async () => {
  const text = files.get('web/src/pages/canvas/project.tsx').产物;
  const src = ts.createSourceFile('project.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(src) === 'handleGenerateNode') callback = node.initializer.arguments[0].getText(src);
    ts.forEachChild(node, visit);
  };
  visit(src); assert.ok(callback);
  let effects = 0, notices = 0;
  const api = loadText('export const run = ' + callback, {}, {
    isGenerationModeEnabled: productPolicy.isGenerationModeEnabled,
    message: { info: () => notices++ },
    nodesRef: { get current() { effects++; throw Error('不应读取节点'); } },
  });
  await api.run('synthetic-node', 'video', 'fixture');
  await api.run('synthetic-node', 'audio', 'fixture');
  assert.equal(effects, 0); assert.equal(notices, 2);
  assert.ok(text.includes('nodesRef.current.filter(hasResumableVideoTask).forEach'));
});

test('C15按钮、面板和JSON序列化消失，图片详情和本地媒体工具不受影响', () => {
  const toolbar = files.get('web/src/components/canvas/canvas-node-hover-toolbar.tsx').产物;
  assert.ok(!toolbar.includes('id: "info"'));
  assert.ok(!toolbar.includes('CanvasNodeInfoModal'));
  assert.ok(!toolbar.includes('JSON.stringify(\n            node'));
  const project = files.get('web/src/pages/canvas/project.tsx').产物;
  assert.ok(!project.includes('infoNodeId')); assert.ok(!project.includes('superResolveNode'));
  assert.ok(project.includes('previewContent ? <img'));
  assert.ok(project.includes('captureVideoNodeFrame'));
});

test('已有快捷工具配置不能重新显示info或超分，不改存储原记录', () => {
  const api = load('web/src/components/canvas/canvas-image-toolbar-tools.tsx', { 'lucide-react': {}, '@/types/canvas': {} });
  const saved = ['info', 'superResolve', 'view', 'upscale', 'download'];
  const before = JSON.stringify(saved);
  assert.deepEqual(Array.from(api.normalizeImageQuickToolIds(saved)), ['download', 'upscale', 'view']);
  assert.equal(JSON.stringify(saved), before);
  assert.ok(!api.imageToolDefinitions.some(item => item.id === 'superResolve'));
});

function promptApi(getItem, setItem, runPromptSource) {
  return load('web/src/services/api/prompts.ts', {
    localforage: { createInstance: () => ({ getItem, setItem }) }, './prompt-source-runtime': { runPromptSource },
    '@/stores/use-prompt-source-store': { usePromptSourceStore: { getState: () => sourceState } },
  });
}

test('过期缓存可离线搜索，封面和外链从读取结果隔离，不改原缓存', async () => {
  let writes = 0, requests = 0;
  const cache = { items: [{ id: 'fixture', title: '尺寸展示', prompt: '长度 宽度 高度', tags: ['尺寸'], coverUrl: 'https://images.example.invalid/cover.png', referenceImageUrls: ['https://images.example.invalid/ref.png'], sourceUrl: 'https://example.invalid/' }], fetchedAt: 0, signature: 'expired' };
  const before = JSON.stringify(cache);
  let current = cache;
  const api = promptApi(async () => current, async () => writes++, async () => { requests++; return []; });
  const rows = await api.fetchSourcePrompts(source.id);
  assert.equal(rows[0].coverUrl, ''); assert.equal(rows[0].githubUrl, ''); assert.equal(rows[0].sourceUrl, '');
  assert.equal(rows[0].referenceImageUrls.length, 0);
  assert.equal((await api.fetchPrompts({ keyword: '长度' })).total, 1);
  current = null;
  assert.equal((await api.fetchSourcePrompts(source.id)).length, 0);
  assert.equal(writes, 0); assert.equal(requests, 0); assert.equal(JSON.stringify(cache), before);
});

test('手动/全部/定时刷新及低层运行器均拒绝，不能绕过离线策略', async () => {
  let effects = 0;
  const hit = () => { effects++; throw Error('不应读写或联网'); };
  const api = promptApi(hit, hit, hit);
  await assert.rejects(api.refreshSource(source.id), denied);
  await assert.rejects(api.refreshAllSources(), denied);
  await assert.rejects(api.refreshDueSources(1), denied);
  const runtime = load('web/src/services/api/prompt-source-runtime.ts', {}, { fetch: hit });
  await assert.rejects(runtime.runPromptSource(source), denied);
  assert.equal(effects, 0);
});

test('原30分钟偏好仍保留，但不启动初始化抓取、定时器或查询失效', () => {
  const effects = []; let network = 0;
  const hit = () => { network++; throw Error('不能调度联网'); };
  const api = loadText(readFileSync(join(运行目录, 'web/src/hooks/use-prompt-source-scheduler.ts'), 'utf8'), {
    react: { useEffect: fn => effects.push(fn) },
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: hit }) },
    '@/services/api/prompts': { refreshDueSources: hit },
    '@/stores/use-prompt-source-store': { usePromptSourceStore: select => select(sourceState) },
  }, { window: { setInterval: hit, clearInterval: hit } });
  api.usePromptSourceScheduler(); assert.equal(effects.length, 1);
  assert.equal(effects[0](), undefined);
  assert.equal(network, 0); assert.equal(sourceState.schedule.intervalMinutes, 30);
});

test('离线来源设置没有网址编辑和网络刷新，内容弹窗按钮只重新读缓存', () => {
  assert.ok(files.get('web/src/components/layout/config-prompt-sources.tsx').产物.includes('LocalPromptSources as ConfigPromptSources'));
  const local = files.get('web/src/guan/离线提示词来源.tsx').产物;
  assert.ok(!local.includes('href=')); assert.ok(!local.includes('refreshSource')); assert.ok(!local.includes('addSource'));
  const modal = files.get('web/src/components/layout/prompt-source-content-modal.tsx').产物;
  assert.ok(modal.includes('onClick={() => void load(false)}'));
  assert.ok(!modal.includes('onClick={() => void load(true)}'));
});

test('视频/语音参数入口去除，图片/文本默认模型及主题设置保留', () => {
  const config = files.get('web/src/components/layout/app-config-modal.tsx').产物;
  for (const key of ['videoResolution', 'audioVoice', 'audioFormat', 'audioSpeed', 'audioInstructions']) assert.ok(!config.includes(`label={t("config.preferences.${key}")}`));
  assert.ok(config.includes('<ThemePreference />'));
  assert.ok(config.includes('modelGroups.filter((group) => isGenerationModeEnabled(group.capability))'));
  assert.ok(files.get('web/src/components/canvas/canvas-config-node-panel.tsx').产物.includes('!isGenerationModeEnabled(mode) || !canGenerate'));
});

function themeFixture(initialDark = false) {
  let dark = initialDark, options;
  const api = load('web/src/guan/三态主题状态.ts', {
    zustand: { create: fakeCreate }, 'zustand/middleware': { persist: (init, opts) => { options = opts; return init; } },
  }, { window: { matchMedia: () => ({ matches: dark }) } });
  return { ...api, options, setDark: value => dark = value };
}

test('新主题默认跟随系统；系统改变不覆盖手动浅/深色', () => {
  const api = themeFixture(true), store = api.useThemeStore;
  assert.equal(store.getState().mode, 'system'); assert.equal(store.getState().theme, 'dark');
  api.setDark(false); store.getState().syncSystemTheme(false);
  assert.equal(store.getState().theme, 'light');
  store.getState().setMode('dark'); store.getState().syncSystemTheme(false);
  assert.equal(store.getState().theme, 'dark');
  store.getState().setMode('light'); store.getState().syncSystemTheme(true);
  assert.equal(store.getState().theme, 'light');
  api.setDark(true); store.getState().setMode('system');
  assert.equal(store.getState().theme, 'dark');
  store.getState().setTheme('light');
  assert.equal(store.getState().mode, 'light');
});

test('旧主题偏好兼容且不修改输入，持久化只保存用户模式', () => {
  const api = themeFixture(true);
  for (const old of ['light', 'dark']) {
    const saved = { theme: old }, before = JSON.stringify(saved);
    const merged = api.options.merge(saved, api.useThemeStore.getState());
    assert.equal(merged.mode, old); assert.equal(merged.theme, old); assert.equal(JSON.stringify(saved), before);
  }
  assert.equal(api.options.merge({ mode: 'system', theme: 'light' }, api.useThemeStore.getState()).theme, 'dark');
  assert.equal(api.resolveThemeMode(null), 'system');
  assert.equal(api.options.name, 'infinite-canvas:theme_store');
  assert.deepEqual(Object.keys(api.options.partialize(api.useThemeStore.getState())), ['mode']);
});

test('主题系统监听注册一次并清理；设置提供三态、与顶栏共用store', () => {
  const effects = []; let added = 0, removed = 0;
  const media = { matches: true, addEventListener: (name, fn) => { assert.equal(name, 'change'); added++; media.callback = fn; }, removeEventListener: (name, fn) => { assert.equal(fn, media.callback); removed++; } };
  const fixture = themeFixture(false);
  const api = load('web/src/guan/三态主题设置.tsx', {
    react: { useEffect: fn => effects.push(fn) }, antd: { Form: { Item: 'FormItem' }, Select: 'Select' },
    './三态主题状态': fixture,
  }, { window: { matchMedia: () => media } });
  api.SystemThemeSync(); const cleanup = effects[0]();
  assert.equal(added, 1); assert.equal(fixture.useThemeStore.getState().theme, 'dark');
  fixture.useThemeStore.getState().setMode('light'); media.callback();
  assert.equal(fixture.useThemeStore.getState().theme, 'light');
  cleanup(); assert.equal(removed, 1);
  const select = flatten(api.ThemePreference()).find(node => node.type === 'Select');
  assert.deepEqual(Array.from(select.props.options, item => item.value), ['system', 'light', 'dark']);
  assert.ok(files.get('web/src/stores/use-theme-store.ts').产物.includes('@/guan/三态主题状态'));
  assert.equal(files.get('web/src/components/layout/app-providers.tsx').产物.split('<SystemThemeSync />').length, 2);
});
