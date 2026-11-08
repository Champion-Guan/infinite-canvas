import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 生成顶栏单来源候选 } from './预审保留顶栏主题与单测试来源.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 运行目录, 哈希 } from './检查运行副本.mjs';
import { 修订前态指纹 } from '../上游适配/顶栏单来源批准.mjs';
import { 测试来源ID, 移除内置来源ID } from '../上游适配/保留顶栏主题与单测试来源.mjs';

const files = 生成顶栏单来源候选();
const text = path => files.get(path)?.产物 ?? readFileSync(join(运行目录, path), 'utf8');
let policy;
function load(path, deps = {}, globals = {}) {
  const { outputText } = ts.transpileModule(text(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  const module = { exports: {} };
  new vm.Script(outputText).runInNewContext({ module, exports: module.exports, URL, DOMException, Blob,
    require: name => {
      if (name === '@/guan/脚本与提示词来源') return policy;
      if (name === '@/i18n') return { t: key => key };
      if (Object.hasOwn(deps, name)) return deps[name];
      throw Error('未声明合成测试依赖：' + name);
    }, ...globals });
  return module.exports;
}
policy = load('web/src/guan/脚本与提示词来源.ts');
const presetsPath = 'web/src/services/api/prompt-source-presets.ts';
const presets = load(presetsPath, { nanoid: { nanoid: () => 'synthetic-id' } });
const originalPresets = (() => {
  const saved = files.get(presetsPath);
  files.set(presetsPath, { ...saved, 产物: saved.原文 });
  try { return load(presetsPath, { nanoid: { nanoid: () => 'synthetic-id' } }); }
  finally { files.set(presetsPath, saved); }
})();
const custom = { id: 'synthetic-custom', name: '合成自定义来源', url: 'https://source.example.invalid/custom.json', homepage: '', enabled: false, builtIn: false };
function fakeCreate(init) {
  if (!init) return fakeCreate;
  let state;
  const store = select => select(state);
  store.getState = () => state;
  store.setState = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  state = init(store.setState, store.getState);
  return store;
}

test('修订为精确10文件，顶栏及主题状态不改，严格识别批准前态或完整后继', () => {
  assert.equal(files.size, 10);
  assert.equal(files.has('web/src/guan/旧版首页顶栏.tsx'), false);
  assert.equal(files.has('web/src/guan/三态主题状态.ts'), false);
  for (const [path, item] of files) assert.equal(修订前态指纹(运行目录, path), 哈希(item.原文));
  const tool = readFileSync(new URL('./预审保留顶栏主题与单测试来源.mjs', import.meta.url), 'utf8');
  assert.ok(tool.includes('仅供预审，不允许接入运行副本'));
});

test('顶栏保留真实主题按钮和setter；仅画布入口与偏好区块关闭', () => {
  const header = text('web/src/guan/旧版首页顶栏.tsx');
  assert.ok(header.includes('<AnimatedThemeToggler'));
  assert.ok(header.includes('const setTheme = useThemeStore((s) => s.setTheme)'));
  assert.ok(header.includes('onThemeChange={setTheme}'));
  assert.equal(load('web/src/guan/功能开关.ts').productFeatures.themeSwitch, false);
  assert.ok(!text('web/src/components/layout/app-config-modal.tsx').includes('ThemePreference'));
  const sync = text('web/src/guan/三态主题设置.tsx');
  assert.ok(sync.includes('export function SystemThemeSync()'));
  assert.ok(!sync.includes('export function ThemePreference()'));
});

test('原主题状态默认跟随系统，顶栏手动切换有效且原持久化偏好保留', () => {
  let options;
  const { useThemeStore: theme } = load('web/src/guan/三态主题状态.ts', {
    zustand: { create: fakeCreate }, 'zustand/middleware': { persist: (init, value) => { options = value; return init; } },
  }, { window: { matchMedia: () => ({ matches: false }) } });
  assert.equal(theme.getState().mode, 'system');
  theme.getState().syncSystemTheme(true);
  assert.equal(theme.getState().theme, 'dark');
  theme.getState().setTheme('light');
  theme.getState().syncSystemTheme(true);
  assert.equal(theme.getState().mode, 'light');
  assert.equal(theme.getState().theme, 'light');
  assert.equal(options.name, 'infinite-canvas:theme_store');
  assert.equal(options.merge({ mode: 'dark' }, theme.getState()).theme, 'dark');
  theme.getState().setMode('system');
  theme.getState().syncSystemTheme(true);
  assert.equal(theme.getState().theme, 'dark');
});

test('7个内置来源精确移除6个，保留Banana原ID/名称/URL与原解析协议', () => {
  assert.equal(originalPresets.DEFAULT_PROMPT_SOURCES.length, 7);
  assert.equal(presets.DEFAULT_PROMPT_SOURCES.length, 1);
  assert.equal(presets.DEFAULT_PROMPT_SOURCES[0].id, 测试来源ID);
  assert.equal(JSON.stringify(presets.DEFAULT_PROMPT_SOURCES[0]), JSON.stringify(originalPresets.DEFAULT_PROMPT_SOURCES[0]));
  assert.deepEqual(Array.from(originalPresets.DEFAULT_PROMPT_SOURCES.slice(1), item => item.id), 移除内置来源ID);
  for (const id of 移除内置来源ID) assert.ok(!text(presetsPath).includes('registrySource("' + id + '"'));
  assert.equal(files.has('web/src/services/api/prompt-source-runtime.ts'), false);
});

test('旧来源持久化恢复只保留1个内置，自定义来源及测试源启停偏好/周期保留', () => {
  let options;
  const { usePromptSourceStore: store } = load('web/src/stores/use-prompt-source-store.ts', {
    zustand: { create: fakeCreate }, 'zustand/middleware': { persist: (init, value) => { options = value; return init; } },
    '@/services/api/prompt-source-presets': presets,
  });
  const saved = { sources: originalPresets.DEFAULT_PROMPT_SOURCES.map(item => ({ ...item, enabled: false })).concat(custom), schedule: { intervalMinutes: 60, lastFetchedAt: 'synthetic-last' } };
  const before = JSON.stringify(saved);
  const next = options.merge(saved, store.getState());
  assert.deepEqual(Array.from(next.sources, item => item.id), [测试来源ID, custom.id]);
  assert.equal(next.sources[0].enabled, false);
  assert.equal(JSON.stringify(next.sources[1]), JSON.stringify(custom));
  assert.equal(next.schedule.intervalMinutes, 60);
  assert.equal(next.schedule.lastFetchedAt, 'synthetic-last');
  assert.equal(JSON.stringify(saved), before);
});

test('恢复旧配置同样过滤6个内置，保留自定义来源/原周期/其他配置，不改原备份对象', async () => {
  const sourceUpdates = [], configUpdates = [];
  const api = load('web/src/services/config-file.ts', {
    'file-saver': { saveAs() {} },
    '@/stores/use-config-store': { useConfigStore: { setState: value => configUpdates.push(value) } },
    '@/stores/use-prompt-source-store': { usePromptSourceStore: { setState: value => sourceUpdates.push(value) } },
    '@/services/api/prompt-source-presets': presets,
  });
  const data = { app: 'infinite-canvas', version: 1, config: { model: 'synthetic-model' }, webdav: { enabled: false }, promptSources: { sources: originalPresets.DEFAULT_PROMPT_SOURCES.concat(custom), schedule: { intervalMinutes: 30, lastFetchedAt: 'synthetic-last' } } };
  const before = JSON.stringify(data);
  await api.importAppConfig({ text: async () => before });
  assert.deepEqual(Array.from(sourceUpdates[0].sources, item => item.id), [测试来源ID, custom.id]);
  assert.equal(JSON.stringify(sourceUpdates[0].sources[1]), JSON.stringify(custom));
  assert.equal(JSON.stringify(sourceUpdates[0].schedule), JSON.stringify(data.promptSources.schedule));
  assert.equal(JSON.stringify(configUpdates[0]), JSON.stringify({ config: data.config, webdav: data.webdav }));
  assert.equal(JSON.stringify(data), before);
});

test('配置导出仍是原实现；不删除任何历史缓存/画布/用户来源', () => {
  const item = files.get('web/src/services/config-file.ts');
  const namedExport = content => {
    const src = ts.createSourceFile('config.ts', content, ts.ScriptTarget.Latest, true);
    return src.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'exportAppConfig').getText(src);
  };
  assert.equal(namedExport(item.产物), namedExport(item.原文));
  for (const [, candidate] of files) assert.ok(!/\.(?:removeItem|clear)\s*\(/.test(candidate.产物));
  for (const path of ['web/src/services/file-storage.ts', 'web/src/stores/canvas/use-canvas-store.ts', 'web/src/stores/use-config-store.ts']) assert.equal(files.has(path), false);
});

test('新增、定时、全部拉取仍在写入/网络前拒绝；原单源手动拉取不改', () => {
  for (const feature of ['modelScripts', 'promptSourceCreate', 'promptRefresh', 'promptRefreshAll']) assert.throws(() => policy.requireBusinessFeature(feature), { code: 'product_feature_disabled' });
  assert.doesNotThrow(() => policy.requireBusinessFeature('promptSources'));
  assert.ok(!text('web/src/components/layout/client-root-init.tsx').includes('usePromptSourceScheduler'));
  const ui = text('web/src/components/layout/config-prompt-sources.tsx');
  for (const removed of ['addSource', 'config.promptSources.schedule', 'handleRefreshAll']) assert.ok(!ui.includes(removed));
  assert.ok(ui.includes('handleRefreshOne(source)'));
  assert.ok(ui.includes('setEditingSource(source)'));
});

test('1个测试来源单独手动拉取可更新缓存，自动和全部刷新仍拒绝', async () => {
  const cache = new Map(); let requests = 0;
  const source = presets.DEFAULT_PROMPT_SOURCES[0];
  const runtime = load('web/src/services/api/prompt-source-runtime.ts', {}, { fetch: async url => {
    assert.equal(url, source.url); requests++;
    return { ok: true, json: async () => [{ id: 'synthetic-prompt', title: '合成测试', prompt: 'fixture', tags: [] }] };
  } });
  const api = load('web/src/services/api/prompts.ts', {
    localforage: { createInstance: () => ({ getItem: async key => cache.get(key) ?? null, setItem: async (key, value) => { cache.set(key, value); } }) },
    './prompt-source-runtime': runtime,
    '@/stores/use-prompt-source-store': { usePromptSourceStore: { getState: () => ({ sources: presets.DEFAULT_PROMPT_SOURCES, schedule: { intervalMinutes: 30 } }) } },
  });
  assert.equal((await api.fetchPrompts()).total, 0);
  assert.equal(requests, 0);
  assert.equal((await api.refreshSource(source.id)).success, true);
  assert.equal((await api.fetchPrompts()).total, 1);
  await assert.rejects(api.refreshAllSources(), { code: 'product_feature_disabled' });
  await assert.rejects(api.refreshDueSources(1), { code: 'product_feature_disabled' });
  assert.equal(requests, 1);
});
