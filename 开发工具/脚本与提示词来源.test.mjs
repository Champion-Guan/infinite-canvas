import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { 生成脚本来源候选 } from './预审脚本与提示词来源.mjs';
import { ts } from './检查首批功能适配.mjs';
import * as policy from '../扩展功能/产品配置/脚本与提示词来源.ts';
import * as originalPolicy from '../扩展功能/产品配置/用户已选功能.ts';

const files = 生成脚本来源候选();
const denied = { code: 'product_feature_disabled' };
const i18n = { t: key => key };
const source = { id: 'synthetic-source', name: '合成旧来源', url: 'https://source.example.invalid/prompts.json', homepage: 'https://source.example.invalid', enabled: true, builtIn: false };
const store = { sources: [source], schedule: { intervalMinutes: 30, lastFetchedAt: '' } };

function load(path, deps = {}, globals = {}) {
  const { outputText } = ts.transpileModule(files.get(path).产物, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  const module = { exports: {} };
  new vm.Script(outputText, { filename: path }).runInNewContext({
    module, exports: module.exports,
    require: name => {
      if (name === '@/guan/脚本与提示词来源') return policy;
      if (name === '@/guan/功能开关') return originalPolicy;
      if (name === '@/i18n') return i18n;
      if (Object.hasOwn(deps, name)) return deps[name];
      throw Error('测试未声明依赖：' + name);
    }, ...globals,
  });
  return module.exports;
}

function fakeCreate(init) {
  if (!init) return fakeCreate;
  let state;
  const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  const storeFn = selector => selector(state);
  storeFn.getState = () => state; storeFn.setState = set;
  state = init(set, storeFn.getState);
  return storeFn;
}

test('仅S03/R02/R03三项静态关闭，配置页签回退，不扩大关闭R01/C14', () => {
  assert.deepEqual(policy.businessFeatures, { modelScripts: false, promptSources: false, promptRefresh: false });
  assert.ok(Object.isFrozen(policy.businessFeatures));
  for (const key of Object.keys(policy.businessFeatures)) assert.throws(() => policy.requireBusinessFeature(key), denied);
  assert.equal(policy.resolveBusinessConfigTab('prompt-sources'), 'channels');
  for (const key of ['channels', 'preferences', 'local-storage']) assert.equal(policy.resolveBusinessConfigTab(key), key);
  assert.equal(files.size, 9);
  assert.ok(!files.has('web/src/components/canvas/canvas-side-panel.tsx'));
  assert.ok(!files.has('web/src/services/config-file.ts'));
});

test('直接调用脚本执行器也在Function构造、凭据注入及网络前拒绝', async () => {
  let effects = 0;
  const hit = () => { effects++; throw Error('不允许执行脚本副作用'); };
  const api = load('web/src/services/api/model-plugin.ts', {
    axios: { request: hit }, '@/stores/use-config-store': { buildApiUrl: hit, withLocalProxy: hit },
  }, { Function: hit, fetch: hit });
  const args = { capability: 'image', script: 'globalThis.executed = true; return []', config: { apiKey: 'synthetic-not-a-real-key' } };
  await assert.rejects(api.runModelPlugin(args), denied);
  assert.equal(effects, 0);
  assert.equal(args.script, 'globalThis.executed = true; return []');
});

test('旧脚本模型明确阻止生成，不清除脚本或静默回退；普通模型仍可解析', () => {
  const api = load('web/src/stores/use-config-store.ts', {
    react: { useMemo: fn => fn() }, zustand: { create: fakeCreate },
    'zustand/middleware': { persist: init => init }, nanoid: { nanoid: () => 'synthetic-id' },
  });
  const config = { channels: [{ id: 'synthetic-channel', models: [{ name: 'scripted-model', script: 'return synthetic;' }, { name: 'ordinary-model' }] }] };
  const before = JSON.stringify(config);
  assert.throws(() => api.resolveModelScript(config, 'scripted-model'), denied);
  assert.equal(api.resolveModelScript(config, 'ordinary-model'), '');
  assert.equal(api.resolveModelScript(config, 'missing-model'), '');
  assert.equal(JSON.stringify(config), before);
});

test('提示词运行器直调也拒绝，来源URL与旧凭据不出网', async () => {
  let requests = 0;
  const api = load('web/src/services/api/prompt-source-runtime.ts', {}, { fetch: () => { requests++; } });
  await assert.rejects(api.runPromptSource(source), denied);
  assert.equal(requests, 0);
});

test('缓存过期、签名变化或无缓存均不刷新；旧提示词仍可搜索读取且缓存不写入', async () => {
  let writes = 0, network = 0;
  const cache = { items: [{ id: 'old-prompt', title: '保留提示词', prompt: '尺寸展示', tags: ['尺寸'] }], fetchedAt: 0, signature: 'deliberately-stale', lastSuccessAt: '2020-01-01T00:00:00Z' };
  const cacheBefore = JSON.stringify(cache);
  let current = cache;
  const api = load('web/src/services/api/prompts.ts', {
    localforage: { createInstance: () => ({ getItem: async () => current, setItem: async () => { writes++; } }) },
    './prompt-source-runtime': { runPromptSource: async () => { network++; return []; } },
    '@/stores/use-prompt-source-store': { usePromptSourceStore: { getState: () => store } },
  });
  const rows = await api.fetchSourcePrompts(source.id);
  assert.equal(rows.length, 1); assert.equal(rows[0].prompt, '尺寸展示');
  const filtered = await api.fetchPrompts({ keyword: '尺寸' });
  assert.equal(filtered.total, 1);
  current = null;
  assert.equal((await api.fetchSourcePrompts(source.id)).length, 0);
  assert.equal(writes, 0); assert.equal(network, 0);
  assert.equal(JSON.stringify(cache), cacheBefore);
});

test('手动、全部和到期刷新都在读取来源或写缓存之前拒绝', async () => {
  let effects = 0;
  const hit = () => { effects++; throw Error('不应读写或请求'); };
  const api = load('web/src/services/api/prompts.ts', {
    localforage: { createInstance: () => ({ getItem: hit, setItem: hit }) },
    './prompt-source-runtime': { runPromptSource: hit },
    '@/stores/use-prompt-source-store': { usePromptSourceStore: { getState: hit } },
  });
  await assert.rejects(api.refreshSource(source.id), denied);
  await assert.rejects(api.refreshAllSources(), denied);
  await assert.rejects(api.refreshDueSources(1), denied);
  assert.equal(effects, 0);
});

test('已有30分钟刷新偏好不启动初始化刷新、定时器或失效请求', () => {
  const effects = []; let calls = 0;
  const hit = () => { calls++; };
  const api = load('web/src/hooks/use-prompt-source-scheduler.ts', {
    react: { useEffect: fn => effects.push(fn) },
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: hit }) },
    '@/services/api/prompts': { refreshDueSources: hit },
    '@/stores/use-prompt-source-store': { usePromptSourceStore: selector => selector(store) },
  }, { window: { setInterval: hit, clearInterval: hit } });
  api.usePromptSourceScheduler();
  assert.equal(effects.length, 1);
  assert.equal(effects[0](), undefined);
  assert.equal(calls, 0);
  assert.equal(store.schedule.intervalMinutes, 30);
});

test('来源增删改/启停与刷新间隔写入拒绝，备份恢复与hydrate仍保留旧配置', () => {
  let options;
  const api = load('web/src/stores/use-prompt-source-store.ts', {
    zustand: { create: fakeCreate },
    'zustand/middleware': { persist: (init, value) => { options = value; return init; } },
    '@/services/api/prompt-source-presets': { DEFAULT_PROMPT_SOURCES: [source], createPromptSource: value => value || { id: 'new' } },
  });
  const local = api.usePromptSourceStore;
  const before = JSON.stringify(options.partialize(local.getState()));
  for (const call of [() => local.getState().addSource(), () => local.getState().saveSource(source), () => local.getState().removeSource(source.id), () => local.getState().toggleSource(source.id, false), () => local.getState().updateSchedule('intervalMinutes', 0)]) assert.throws(call, denied);
  assert.equal(JSON.stringify(options.partialize(local.getState())), before);
  const saved = { sources: [source], schedule: { intervalMinutes: 60, lastFetchedAt: '2020-01-01T00:00:00Z' } };
  const savedBefore = JSON.stringify(saved);
  const merged = options.merge(saved, local.getState());
  assert.equal(merged.sources.some(item => item.id === source.id), true);
  assert.equal(merged.schedule.intervalMinutes, 60);
  assert.equal(JSON.stringify(saved), savedBefore);
  assert.equal(policy.businessFeatures.promptRefresh, false);
});
