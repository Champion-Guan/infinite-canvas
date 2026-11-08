import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 生成局部关闭候选 } from './预审仅系统主题与来源局部关闭.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 运行目录, 哈希 } from './检查运行副本.mjs';
import { 修订前态指纹 } from '../上游适配/顶栏单来源批准.mjs';

const files = 生成局部关闭候选();
const denied = { code: 'product_feature_disabled' };
const source = { id: 'synthetic-existing', name: '合成既有来源', url: 'https://source.example.invalid/prompts.json', homepage: 'https://source.example.invalid', enabled: true, builtIn: false };
let sourcePolicy;
const text = path => files.get(path)?.产物 ?? readFileSync(join(运行目录, path), 'utf8');
function load(path, deps = {}, globals = {}) {
  const result = ts.transpileModule(text(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  const module = { exports: {} };
  new vm.Script(result.outputText).runInNewContext({ module, exports: module.exports, URL, DOMException,
    require: name => {
      if (name === '@/guan/脚本与提示词来源') return sourcePolicy;
      if (name === '@/i18n') return { t: key => key };
      if (Object.hasOwn(deps, name)) return deps[name];
      throw Error('未声明合成测试依赖：' + name);
    }, ...globals });
  return module.exports;
}
sourcePolicy = load('web/src/guan/脚本与提示词来源.ts');
function fakeCreate(init) {
  if (!init) return fakeCreate;
  let state, writes = 0;
  const set = patch => { writes++; state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  const store = select => select(state);
  store.getState = () => state;
  store.setState = set;
  store.writes = () => writes;
  state = init(set, store.getState);
  return store;
}
function namedFunction(content, name) {
  const src = ts.createSourceFile('file.tsx', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = src.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, '没有找到函数：' + name);
  return node.getText(src);
}

test('旧10文件候选仍只读，核对历史前态，拒绝接入参数', () => {
  assert.equal(files.size, 10);
  for (const [path, item] of files) {
    assert.equal(修订前态指纹(运行目录, path), 哈希(item.原文));
    assert.notEqual(item.产物, item.原文);
  }
  const tool = readFileSync(new URL('./预审仅系统主题与来源局部关闭.mjs', import.meta.url), 'utf8');
  assert.ok(tool.includes("!['--完整类型预审', '--生成审查差异'].includes(arg)"));
  assert.ok(tool.includes('仅供预审，不允许接入运行副本'));
});

test('画布两处手动主题开关关闭，顶栏不再渲染切换器，偏好保留其他设置', () => {
  const flags = load('web/src/guan/功能开关.ts');
  assert.equal(flags.productFeatures.themeSwitch, false);
  for (const path of ['web/src/components/layout/user-status-actions.tsx', 'web/src/components/canvas/canvas-toolbar.tsx']) assert.ok(text(path).includes('productFeatures.themeSwitch ?'));
  const header = text('web/src/guan/旧版首页顶栏.tsx');
  assert.ok(!header.includes('AnimatedThemeToggler'));
  assert.ok(!header.includes('s.setTheme'));
  assert.ok(header.includes('s.theme'));
  const config = text('web/src/components/layout/app-config-modal.tsx');
  assert.ok(!config.includes('ThemePreference'));
  for (const key of ['videoResolution', 'audioVoice', 'audioFormat', 'audioSpeed', 'audioInstructions']) assert.ok(config.includes(`label={t("config.preferences.${key}")}`));
});

test('系统浅/深启动和变化同步，旧手动setter不再覆盖，重复同步不触发更新', () => {
  for (const dark of [false, true]) {
    const theme = load('web/src/guan/三态主题状态.ts', { zustand: { create: fakeCreate } }, {
      window: { matchMedia: query => { assert.equal(query, '(prefers-color-scheme: dark)'); return { matches: dark }; }, get localStorage() { throw Error('不能读写旧主题偏好'); } },
    }).useThemeStore;
    assert.equal(theme.getState().mode, 'system');
    assert.equal(theme.getState().theme, dark ? 'dark' : 'light');
    theme.getState().setTheme(dark ? 'light' : 'dark');
    theme.getState().setMode('light');
    assert.equal(theme.writes(), 0);
    theme.getState().syncSystemTheme(dark);
    assert.equal(theme.writes(), 0);
    theme.getState().syncSystemTheme(!dark);
    assert.equal(theme.getState().theme, dark ? 'light' : 'dark');
    assert.equal(theme.writes(), 1);
    assert.equal(theme.getState().mode, 'system');
  }
  assert.ok(!text('web/src/guan/三态主题状态.ts').includes('persist('));
});

test('无window或无matchMedia时安全回退浅色', () => {
  for (const globals of [{}, { window: {} }]) {
    const theme = load('web/src/guan/三态主题状态.ts', { zustand: { create: fakeCreate } }, globals);
    assert.equal(theme.useThemeStore.getState().theme, 'light');
  }
});

test('系统监听只挂载一次、随变化同步并在卸载清理，根Provider不重复挂载', () => {
  let effect, listener, removed;
  const syncs = [], media = { matches: false, addEventListener: (name, fn) => { assert.equal(name, 'change'); assert.equal(listener, undefined); listener = fn; }, removeEventListener: (name, fn) => { assert.equal(name, 'change'); removed = fn; } };
  const api = load('web/src/guan/三态主题设置.tsx', {
    react: { useEffect: (fn, dependencies) => { assert.equal(dependencies.length, 0); effect = fn; } },
    './三态主题状态': { useThemeStore: { getState: () => ({ syncSystemTheme: dark => syncs.push(dark) }) } },
  }, { window: { matchMedia: () => media } });
  assert.equal(api.SystemThemeSync(), null);
  const cleanup = effect();
  media.matches = true; listener(); cleanup();
  assert.deepEqual(syncs, [false, true]);
  assert.equal(removed, listener);
  assert.equal(text('web/src/components/layout/app-providers.tsx').split('<SystemThemeSync />').length, 2);
  assert.equal(api.ThemePreference, undefined);
});

test('来源策略保留管理、单源手动刷新，新增/自动/全部拉取拒绝', () => {
  assert.equal(Object.isFrozen(sourcePolicy.businessFeatures), true);
  assert.doesNotThrow(() => sourcePolicy.requireBusinessFeature('promptSources'));
  for (const key of ['modelScripts', 'promptRefresh', 'promptSourceCreate', 'promptRefreshAll']) assert.throws(() => sourcePolicy.requireBusinessFeature(key), denied);
});

test('来源UI移除新增及完整定时区块，既有编辑/启停/查看/删除/手动刷新原样保留', () => {
  const path = 'web/src/components/layout/config-prompt-sources.tsx';
  const ui = text(path);
  for (const removed of ['addSource', 'config.promptSources.add', 'config.promptSources.schedule', 'handleRefreshAll', 'refreshAllSources', 'updateSchedule', 'intervalKey', 'PROMPT_SOURCE_INTERVALS']) assert.ok(!ui.includes(removed), removed);
  for (const retained of ['toggleSource(source.id, checked)', 'setViewingId(source.id)', 'setEditingSource(source)', 'handleDelete(source)', 'handleRefreshOne(source)', 'PromptSourceEditorDrawer', 'PromptSourceContentModal']) assert.ok(ui.includes(retained), retained);
  for (const handler of ['handleSave', 'handleDelete', 'handleRefreshOne']) {
    const src = ts.createSourceFile('ui.tsx', files.get(path).原文, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const find = node => { if (ts.isVariableDeclaration(node) && node.name.getText(src) === handler) return node.initializer.getText(src); return ts.forEachChild(node, find); };
    assert.ok(ui.includes(find(src)), handler + '应逐字保留');
  }
  assert.ok(text('web/src/components/layout/prompt-source-content-modal.tsx').includes('onClick={() => void load(true)}'));
});

function sourceStoreFixture() {
  let persistOptions, creations = 0;
  const builtIn = { ...source, id: 'synthetic-builtin', builtIn: true };
  const store = load('web/src/stores/use-prompt-source-store.ts', {
    zustand: { create: fakeCreate },
    'zustand/middleware': { persist: (init, options) => { persistOptions = options; return init; } },
    '@/services/api/prompt-source-presets': { DEFAULT_PROMPT_SOURCES: [builtIn, source], createPromptSource: value => { creations++; return { ...value }; } },
  }).usePromptSourceStore;
  return { store, persistOptions, creations: () => creations };
}

test('store拦住新增和新ID保存，不修改旧来源与原30分钟周期', () => {
  const f = sourceStoreFixture(), before = JSON.stringify(f.store.getState());
  assert.throws(() => f.store.getState().addSource(), denied);
  assert.throws(() => f.store.getState().saveSource({ ...source, id: 'synthetic-new' }), denied);
  assert.throws(() => f.store.getState().updateSchedule('intervalMinutes', 0), denied);
  assert.equal(f.creations(), 0);
  assert.equal(f.store.writes(), 0);
  assert.equal(JSON.stringify(f.store.getState()), before);
  assert.equal(f.store.getState().schedule.intervalMinutes, 30);
});

test('既有自定义来源可编辑/启停/删除，内置来源仍不能改写或删除', () => {
  const { store } = sourceStoreFixture();
  store.getState().saveSource({ ...source, name: '合成修改' });
  assert.equal(store.getState().sources.find(item => item.id === source.id).name, '合成修改');
  store.getState().toggleSource(source.id, false);
  assert.equal(store.getState().sources.find(item => item.id === source.id).enabled, false);
  store.getState().saveSource({ ...source, id: 'synthetic-builtin', name: '不得改写' });
  store.getState().removeSource('synthetic-builtin');
  assert.equal(store.getState().sources.find(item => item.id === 'synthetic-builtin').name, source.name);
  store.getState().removeSource(source.id);
  assert.equal(store.getState().sources.length, 1);
});

test('旧持久化来源与周期不重置，备份导入接口不变但仍不能启用调度', () => {
  const f = sourceStoreFixture();
  assert.equal(f.persistOptions.name, 'infinite-canvas:prompt_source_store_v2');
  const restored = f.persistOptions.merge({ sources: [{ ...source, enabled: false }], schedule: { intervalMinutes: 60, lastFetchedAt: 'synthetic-timestamp' } }, f.store.getState());
  assert.equal(restored.sources.find(item => item.id === source.id).enabled, false);
  assert.equal(restored.schedule.intervalMinutes, 60);
  assert.equal(restored.schedule.lastFetchedAt, 'synthetic-timestamp');
  assert.equal(files.has('web/src/services/config-file.ts'), false);
  assert.ok(text('web/src/services/config-file.ts').includes('usePromptSourceStore.setState'));
});

test('根初始化不再挂调度hook；兼容hook即使旧周期非零也不建timer或出网', async () => {
  const root = text('web/src/components/layout/client-root-init.tsx');
  assert.ok(!root.includes('usePromptSourceScheduler'));
  for (const intervalMinutes of [0, 30, 60]) {
    let effect, effects = 0;
    const hit = () => { effects++; throw Error('自动调度不能执行'); };
    const scheduler = load('web/src/hooks/use-prompt-source-scheduler.ts', {
      react: { useEffect: fn => { effect = fn; } },
      '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: hit }) },
      '@/services/api/prompts': { refreshDueSources: hit },
      '@/stores/use-prompt-source-store': { usePromptSourceStore: select => select({ schedule: { intervalMinutes } }) },
    }, { window: { setInterval: hit, clearInterval: hit } });
    scheduler.usePromptSourceScheduler();
    assert.equal(effect(), undefined);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(effects, 0);
  }
});

function apiFixture(fail = false) {
  const cache = new Map(); let requests = 0, writes = 0, reads = 0;
  const runtime = load('web/src/services/api/prompt-source-runtime.ts', {}, { fetch: async url => {
    assert.equal(url, source.url); requests++;
    if (fail) throw Error('synthetic-network-failure');
    return { ok: true, json: async () => [{ id: 'p1', title: '尺寸展示', prompt: '长度 宽度 高度', tags: ['尺寸'], coverUrl: '/cover.png', referenceImageUrls: ['/ref.png'], sourceUrl: '/item' }] };
  } });
  const api = load('web/src/services/api/prompts.ts', {
    localforage: { createInstance: () => ({ getItem: async key => { reads++; return cache.get(key) ?? null; }, setItem: async (key, value) => { writes++; cache.set(key, value); } }) },
    './prompt-source-runtime': runtime,
    '@/stores/use-prompt-source-store': { usePromptSourceStore: { getState: () => ({ sources: [source], schedule: { intervalMinutes: 30 } }) } },
  });
  return { api, cache, counts: () => ({ requests, writes, reads }) };
}

test('自动与全部拉取API直接拒绝，缓存读取前即停止', async () => {
  const f = apiFixture();
  await assert.rejects(f.api.refreshDueSources(1), denied);
  await assert.rejects(f.api.refreshAllSources(), denied);
  assert.deepEqual(f.counts(), { requests: 0, writes: 0, reads: 0 });
});

test('缺失/过期/来源签名变化的缓存读取均不自动联网或写库', async () => {
  const f = apiFixture();
  assert.equal((await f.api.fetchSourcePrompts(source.id)).length, 0);
  const old = { items: [{ id: 'old', title: '旧标题', prompt: '原文保留', tags: [] }], count: 1, fetchedAt: 1, lastSuccessAt: '2020-01-01T00:00:00Z', lastError: '', signature: 'stale' };
  f.cache.set('prompt-source:' + source.id, old);
  assert.equal((await f.api.fetchSourcePrompts(source.id))[0].prompt, '原文保留');
  assert.equal((await f.api.fetchPrompts()).total, 1);
  assert.equal(f.counts().requests, 0); assert.equal(f.counts().writes, 0);
  assert.equal(f.cache.get('prompt-source:' + source.id), old);
});

test('单源手动拉取仍真实解析合成响应，保留远程封面/参考图，并发去重', async () => {
  const f = apiFixture();
  const [a, b] = await Promise.all([f.api.refreshSource(source.id), f.api.refreshSource(source.id)]);
  assert.equal(a.success, true); assert.equal(b.success, true);
  assert.equal(f.counts().requests, 1); assert.equal(f.counts().writes, 1);
  const item = f.cache.get('prompt-source:' + source.id).items[0];
  assert.equal(item.coverUrl, 'https://source.example.invalid/cover.png');
  assert.equal(item.referenceImageUrls[0], 'https://source.example.invalid/ref.png');
  assert.equal(item.prompt, '长度 宽度 高度');
});

test('单源拉取失败保留旧提示词及最后成功时间，不清空缓存', async () => {
  const f = apiFixture(true);
  const old = { items: [{ id: 'old', title: '旧标题', prompt: '原文保留', tags: [] }], count: 1, fetchedAt: 1, lastSuccessAt: '2020-01-01T00:00:00Z', lastError: '', signature: 'stale' };
  f.cache.set('prompt-source:' + source.id, old);
  await assert.rejects(f.api.refreshSource(source.id));
  const after = f.cache.get('prompt-source:' + source.id);
  assert.equal(JSON.stringify(after.items), JSON.stringify(old.items));
  assert.equal(after.lastSuccessAt, old.lastSuccessAt); assert.ok(after.lastError);
});

test('不改变音视频/节点信息/模型脚本策略/生成API/画布数据接口', () => {
  for (const path of ['web/src/guan/精简与离线策略.ts', 'web/src/pages/canvas/project.tsx', 'web/src/components/canvas/canvas-node-hover-toolbar.tsx', 'web/src/services/api/audio.ts', 'web/src/services/api/video.ts', 'web/src/services/file-storage.ts', 'web/src/stores/canvas/use-canvas-store.ts', 'web/src/stores/use-config-store.ts', 'web/src/router.tsx']) assert.equal(files.has(path), false);
  const path = 'web/src/services/api/prompts.ts';
  for (const name of ['refreshSource', 'getSourcePrompts', 'refreshSourceRecord', 'fetchPrompts']) assert.equal(namedFunction(files.get(path).产物, name), namedFunction(files.get(path).原文, name));
});
