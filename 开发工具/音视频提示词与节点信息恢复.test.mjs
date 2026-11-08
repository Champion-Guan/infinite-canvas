import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 生成合并恢复候选 } from './预审音视频提示词与节点信息恢复.mjs';
import { 生成精简主题候选 } from './预审精简离线与三态主题.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 运行目录, 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 修订前态指纹 } from '../上游适配/顶栏单来源批准.mjs';

const files = 生成合并恢复候选();
const previous = 生成精简主题候选();
let productPolicy, sourcePolicy;
function load(path, deps = {}, globals = {}) {
  const text = files.get(path)?.产物 ?? readFileSync(join(运行目录, path), 'utf8');
  const result = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  const module = { exports: {} };
  new vm.Script(result.outputText).runInNewContext({ module, exports: module.exports, URL, DOMException, require: name => {
    if (name === '@/guan/精简与离线策略') return productPolicy;
    if (name === '@/guan/脚本与提示词来源') return sourcePolicy;
    if (name === '@/i18n') return { t: key => key };
    if (Object.hasOwn(deps, name)) return deps[name];
    throw Error('未声明合成测试依赖：' + name);
  }, ...globals });
  return module.exports;
}
productPolicy = load('web/src/guan/精简与离线策略.ts');
sourcePolicy = load('web/src/guan/脚本与提示词来源.ts');
const source = { id: 'synthetic-restored-source', name: '合成恢复来源', url: 'https://source.example.invalid/prompts.json', homepage: 'https://source.example.invalid', enabled: true, builtIn: false };

test('合并恢复精确10文件，仅接受完整前态或批准后态，不触碰路由/数据库/主题模块', () => {
  assert.equal(files.size, 10);
  const applied = 检查运行副本().音视频提示词与节点信息恢复已应用;
  for (const [path, item] of files) assert.equal(修订前态指纹(运行目录, path), 哈希(applied ? item.产物 : item.原文));
  for (const path of ['web/src/router.tsx', 'web/src/stores/canvas/use-canvas-store.ts', 'web/src/guan/三态主题状态.ts', 'web/src/services/file-storage.ts']) assert.equal(files.has(path), false);
});

test('仅恢复四类生成、节点信息和提示词联网；脚本/网址凭据/超分仍拒绝', () => {
  for (const mode of ['image', 'text', 'video', 'audio']) assert.doesNotThrow(() => productPolicy.requireGenerationMode(mode));
  assert.throws(() => productPolicy.requireGenerationMode('unknown'), { code: 'product_feature_disabled' });
  assert.doesNotThrow(() => productPolicy.requireAuxiliaryFeature('nodeInfo'));
  assert.doesNotThrow(() => productPolicy.requireAuxiliaryFeature('promptNetwork'));
  for (const key of ['urlCredentials', 'superResolve']) assert.throws(() => productPolicy.requireAuxiliaryFeature(key), { code: 'product_feature_disabled' });
  assert.equal(sourcePolicy.businessFeatures.promptSources, true);
  assert.equal(sourcePolicy.businessFeatures.promptRefresh, true);
  assert.throws(() => sourcePolicy.requireBusinessFeature('modelScripts'), { code: 'product_feature_disabled' });
});

function promptFixture(fail = false) {
  const cache = new Map(); let requests = 0;
  const runtime = load('web/src/services/api/prompt-source-runtime.ts', {}, { fetch: async url => {
    assert.equal(url, source.url); requests++;
    if (fail) throw Error('synthetic-network-failure');
    return { ok: true, json: async () => [{ id: 'p1', title: '尺寸展示', prompt: '长度 宽度 高度', tags: ['尺寸'], coverUrl: '/cover.png', referenceImageUrls: ['/ref.png'], sourceUrl: '/item' }] };
  } });
  const state = { sources: [source], schedule: { intervalMinutes: 30 } };
  const api = load('web/src/services/api/prompts.ts', {
    localforage: { createInstance: () => ({ getItem: async key => cache.get(key) ?? null, setItem: async (key, value) => { cache.set(key, value); } }) },
    './prompt-source-runtime': runtime,
    '@/stores/use-prompt-source-store': { usePromptSourceStore: { getState: () => state } },
  });
  return { api, cache, requests: () => requests };
}

test('R02手动刷新实际解析合成JSON、保存缓存并保留远程封面/参考图；并发去重', async () => {
  const f = promptFixture();
  const [a, b] = await Promise.all([f.api.refreshSource(source.id), f.api.refreshSource(source.id)]);
  assert.equal(a.success, true); assert.equal(b.success, true); assert.equal(f.requests(), 1);
  const item = f.cache.get('prompt-source:' + source.id).items[0];
  assert.equal(item.coverUrl, 'https://source.example.invalid/cover.png');
  assert.equal(item.referenceImageUrls[0], 'https://source.example.invalid/ref.png');
  assert.equal(item.prompt, '长度 宽度 高度');
  const due = await f.api.refreshDueSources(30 * 60_000);
  assert.equal(due.results.length, 0); assert.equal(f.requests(), 1);
});

test('刷新失败保留原提示词及最后成功时间，只登记错误，不清空缓存', async () => {
  const f = promptFixture(true);
  const old = { items: [{ id: 'old', title: '旧标题', prompt: '原文保留', tags: [] }], count: 1, fetchedAt: 1, lastSuccessAt: '2020-01-01T00:00:00Z', lastError: '', signature: 'stale' };
  const content = JSON.stringify(old.items);
  f.cache.set('prompt-source:' + source.id, old);
  await assert.rejects(f.api.refreshSource(source.id));
  const after = f.cache.get('prompt-source:' + source.id);
  assert.equal(JSON.stringify(after.items), content);
  assert.equal(after.lastSuccessAt, old.lastSuccessAt);
  assert.ok(after.lastError);
});

test('R03启动检查、分钟调度和卸载清理恢复；间隔0仍不调度', async () => {
  for (const intervalMinutes of [0, 30]) {
    let effect, timer, cleared, requests = 0;
    const state = { schedule: { intervalMinutes } };
    const api = load('web/src/hooks/use-prompt-source-scheduler.ts', {
      react: { useEffect: fn => { effect = fn; } },
      '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
      '@/services/api/prompts': { refreshDueSources: async age => { assert.equal(age, intervalMinutes * 60_000); requests++; return { results: [] }; } },
      '@/stores/use-prompt-source-store': { usePromptSourceStore: Object.assign(select => select(state), { getState: () => ({ updateSchedule() {} }) }) },
    }, { window: { setInterval: (callback, delay) => { timer = { callback, delay }; return 9; }, clearInterval: id => { cleared = id; } } });
    api.usePromptSourceScheduler(); const cleanup = effect();
    await new Promise(resolve => setImmediate(resolve));
    if (!intervalMinutes) { assert.equal(requests, 0); assert.equal(timer, undefined); assert.equal(cleanup, undefined); }
    else { assert.equal(requests, 1); assert.equal(timer.delay, 60_000); await timer.callback(); assert.equal(requests, 2); cleanup(); assert.equal(cleared, 9); }
  }
});

test('来源管理与内容刷新恢复原作者实现，不保留仅离线占位页', () => {
  for (const path of ['web/src/components/layout/config-prompt-sources.tsx', 'web/src/services/api/prompts.ts', 'web/src/services/api/prompt-source-runtime.ts', 'web/src/components/layout/prompt-source-content-modal.tsx']) assert.equal(files.get(path).产物, previous.get(path).原文);
  const sourceUi = files.get('web/src/components/layout/config-prompt-sources.tsx').产物;
  for (const text of ['setEditingSource(addSource())', 'handleRefreshOne(source)', 'handleRefreshAll()', 'updateSchedule("intervalMinutes", value)', 'PromptSourceEditorDrawer']) assert.ok(sourceUi.includes(text));
  assert.ok(files.get('web/src/components/layout/prompt-source-content-modal.tsx').产物.includes('onClick={() => void load(true)}'));
});

function namedFunction(text, name) {
  const src = ts.createSourceFile('toolbar.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const value = src.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(value); return value.getText(src);
}

test('C15真实信息/JSON组件逐字恢复，状态、清理和事件挂载齐全，超分仍移除', () => {
  const path = 'web/src/components/canvas/canvas-node-hover-toolbar.tsx';
  const toolbar = files.get(path).产物;
  for (const name of ['CanvasNodeInfoModal', 'InfoRow']) assert.equal(namedFunction(toolbar, name), namedFunction(previous.get(path).原文, name));
  assert.ok(toolbar.includes('{ id: "info"'));
  const project = files.get('web/src/pages/canvas/project.tsx').产物;
  for (const text of ['const [infoNodeId, setInfoNodeId]', 'onInfo={(node) => setInfoNodeId(node.id)}', '<CanvasNodeInfoModal node={infoNode}', 'setInfoNodeId(null)']) assert.ok(project.includes(text));
  assert.ok(!project.includes('superResolveNode'));
  assert.ok(!toolbar.includes('onSuperResolve'));
});

test('图片快捷工具默认恢复info，不重置用户自选；超分不重新出现', () => {
  const api = load('web/src/components/canvas/canvas-image-toolbar-tools.tsx', { 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) }, 'lucide-react': {}, '@/types/canvas': {} });
  assert.equal(api.defaultImageQuickToolIds.includes('info'), true);
  assert.equal(api.imageToolDefinitions.some(item => item.id === 'superResolve'), false);
  assert.deepEqual(Array.from(api.readImageQuickToolsConfig({ ids: ['delete', 'download'], showLabels: true }).ids), ['delete', 'download']);
  assert.deepEqual(Array.from(api.normalizeImageQuickToolIds(['info', 'download', 'superResolve'])), ['info', 'download']);
});

test('音视频默认参数与三态主题同时保留，媒体任务/保存/数据库接口不改', () => {
  const config = files.get('web/src/components/layout/app-config-modal.tsx').产物;
  for (const key of ['videoResolution', 'audioVoice', 'audioFormat', 'audioSpeed', 'audioInstructions']) assert.ok(config.includes(`label={t("config.preferences.${key}")}`));
  assert.equal(config.split('<ThemePreference />').length, 2);
  for (const path of ['web/src/services/api/audio.ts', 'web/src/services/api/video.ts', 'web/src/services/file-storage.ts', 'web/src/stores/canvas/use-canvas-store.ts', 'web/src/stores/use-config-store.ts']) assert.equal(files.has(path), false);
});
