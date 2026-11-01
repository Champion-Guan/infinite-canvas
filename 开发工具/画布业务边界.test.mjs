import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import globals from 'globals';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { clearConfirmedImageErrors } from '../扩展功能/画布生成/图片任务确认恢复.mjs';
import { canvasTaskSummary } from '../扩展功能/产品/产品任务摘要.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = { useCallback: value => value, useRef: value => ({ current: value }) };
async function load(name, dependencies) {
  const file = resolve(root, '扩展功能', name);
  const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    assert.ok(Object.hasOwn(dependencies, id), '未注入依赖：' + id);
    return dependencies[id];
  }, module, module.exports);
  return module.exports;
}
test('主画布和拆出模块没有遗漏的函数或变量引用', async () => {
  const linter = new Linter();
  const files = ['.运行/3100源/画布副本/web/src/pages/canvas/project.tsx',
    '扩展功能/画布生成/生成参数继承.ts', '扩展功能/画布生成/生成任务回执操作.ts', '扩展功能/画布生成/批量生成操作.ts',
    '扩展功能/画布导入/当前画布导入操作.ts', '扩展功能/画布回收/节点回收操作.ts',
    '扩展功能/Excel画布/Excel插入操作.ts', '扩展功能/Excel画布/Excel参数操作.ts', '扩展功能/Excel画布/Excel拖入校验.ts',
    '扩展功能/画布生成/提示词翻译操作.ts', '扩展功能/画布生成/单卡配置创建.ts', '扩展功能/媒体交付/画布下载操作.ts',
    '扩展功能/Excel画布/旧版参数卡片.tsx', '扩展功能/Excel画布/产品参数联动.ts', '扩展功能/Excel画布/产品参数编辑操作.ts', '扩展功能/画布布局/批量结果排布.ts',
    '扩展功能/媒体交付/图片结果回写.ts', '扩展功能/媒体交付/图片结果保存操作.ts', '扩展功能/媒体交付/图片批次操作.ts',
    '扩展功能/生成历史/历史选择操作.ts', '扩展功能/生成历史/历史下载操作.ts', '扩展功能/生成历史/历史媒体预览.ts',
    '扩展功能/生成历史/历史总览面板.tsx', '扩展功能/生成历史/生成历史页签.tsx',
    '扩展功能/画布生成/画布节点事务.ts', '扩展功能/产品/画布保存接线.ts', '扩展功能/画布生成/全局参考图操作.ts',
    '扩展功能/画布回收/节点删除操作.ts', '扩展功能/画布布局/重叠卡片整理操作.ts', '扩展功能/画布布局/节点复制操作.ts'];
  for (const name of files) {
    const file = resolve(root, name);
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: name.endsWith('.tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const messages = linter.verify(code, { languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.browser, ...globals.es2022 } }, rules: { 'no-undef': 'error' } });
    assert.deepEqual(messages, [], name + '存在未定义引用：' + messages.map(item => item.message).join('；'));
  }
});
test('配置卡片执行保留创建时快照；普通节点仍继承相连参数，且不修改原节点', async () => {
  const functions = await load('画布生成/生成参数继承.ts', {
    '@/types/canvas': { CanvasNodeType: { Config: 'config' } },
    '@/lib/canvas/canvas-generation-helpers': { getGenerationCount: value => Math.max(1, Number(value) || 1) },
    '../安全与批量/prompt-generation-mode': { promptGenerationMode: () => 'image' },
  });
  const config = { id: 'config', type: 'config', metadata: { size: '900x1200', quality: 'high' } };
  const prompt = { id: 'prompt', metadata: { size: '1152x1536', quality: 'low', prompt: '用户原文' } };
  const edges = [{ fromNodeId: 'prompt', toNodeId: 'config' }];
  assert.equal(functions.generationNodeForExecution(config, 'config', [prompt, config], edges), config);
  const normal = { ...config, type: 'image' };
  const inherited = functions.generationNodeForExecution(normal, 'config', [prompt, normal], edges);
  assert.equal(inherited.metadata.size, '1152x1536');
  assert.equal(normal.metadata.size, '900x1200');
  assert.equal(inherited.metadata.prompt, undefined);
  assert.deepEqual(functions.promptGenerationPatch('900 x 1200 px, 3:4 MAIN IMAGE'), {
    size: '900x1200', generationAspectRatio: '3:4', generationPixelWidth: 900, generationPixelHeight: 1200,
    generationImageType: 'main image', generationParamsDetected: true,
  });
});
test('确认清理保存失败后仅重试保存；节点不存在时不记录或发送任务', async () => {
  let saves = 0, submissions = 0;
  const nodesRef = { current: [{ id: 'node', type: 'text', metadata: { primaryTextId: 'slot', content: '已完成文本', gatewayGenerationTasks: [{ taskId: 'task', slotId: 'slot' }], gatewayGenerationReceipts: [{ taskId: 'task', responseHash: 'hash' }], status: 'success', errorDetails: '保存失败' } }] };
  const { useCanvasTaskReceipts } = await load('画布生成/生成任务回执操作.ts', {
    react: hooks, './图片任务确认恢复.mjs': { clearConfirmedImageErrors },
    './原画布文本调用': { requestCanvasText: async () => { submissions++; } },
    './原画布音频调用': { requestCanvasAudio: async () => { submissions++; } },
    '@/services/api/audio': { storeGeneratedAudio: async () => { throw Error('此检查不交付音频'); } },
    '../产品/产品操作': { saveProductCanvas: async () => { if (++saves === 1) throw Error('保存失败'); } },
  });
  const api = useCanvasTaskReceipts({ projectId: 'product', nodesRef, restoredProjectIdRef: { current: 'product' }, setNodes: value => { nodesRef.current = typeof value === 'function' ? value(nodesRef.current) : value; } });
  const target = { id: 'task', productId: 'product', nodeId: 'node', responseHash: 'hash' };
  await assert.rejects(api.clearConfirmedImageError(target), /保存失败/);
  await api.clearConfirmedImageError(target);
  await api.clearConfirmedImageError(target);
  assert.equal(saves, 2);
  assert.equal(submissions, 0);
  await assert.rejects(api.recordImageGatewayTask('missing', {}), /卡片已删除/);
  await assert.rejects(api.requestNodeText({}, [], () => {}, { signal: new AbortController().signal, nodeId: 'missing', slotId: 'slot' }), /卡片已删除/);
  assert.equal(saves, 2); assert.equal(submissions, 0);
});
test('导入期间切走原画布会停止应用，清理此次素材并保留原历史', async () => {
  let assertions = 0, applied = 0, saves = 0;
  const removed = [], errors = [], historyRef = { current: { past: [], future: [] } };
  const { useCanvasContentImport } = await load('画布导入/当前画布导入操作.ts', {
    react: hooks,
    '@/lib/zip': { readZip: async () => new Map([['projects.json', { text: async () => '{}' }]]) },
    '@/services/image-storage': { setImageBlob: async () => {}, deleteStoredImages: async keys => removed.push(...keys) },
    '@/services/file-storage': { setMediaBlob: async () => {}, deleteStoredMedia: async () => {} },
    '@/lib/canvas/canvas-generation-helpers': { hydrateCanvasImages: async nodes => nodes },
    './画布内容导入': { prepareCanvasContentImport: () => ({ nodes: [], connections: [], media: [{ key: 'image:new', blob: new Blob(['x']) }] }) },
    '../安全与批量/update-activity': { observeActivity: async (_kind, action) => action() },
    '../安全与批量/settle-activity-group': { settleActivityGroup: values => Promise.all(values) },
    '../画布布局/卡片自动避让': { placeNewCanvasNodes: (_old, nodes) => nodes },
    '../产品/产品操作': { saveProductCanvas: async () => { saves++; } },
  });
  const api = useCanvasContentImport({ projectId: 'product', nodesRef: { current: [] }, historyRef,
    createHistoryEntry: () => ({ nodes: [], connections: [] }), applyHistory: () => { applied++; }, setSelectedNodeIds: () => {},
    assertImportTarget: () => { if (++assertions === 3) throw Error('原画布已切换'); },
    message: { loading: () => () => {}, error: value => errors.push(value), success: () => {} },
  });
  await api.importCurrentContents({ size: 1 });
  assert.equal(applied, 0); assert.equal(saves, 0);
  assert.deepEqual(removed, ['image:new']);
  assert.deepEqual(historyRef.current, { past: [], future: [] });
  assert.match(errors[0], /原画布已切换/);
});
test('回收恢复缺少素材时保留原批次，不改节点、撤销记录或保存', async () => {
  let applied = 0, updated = 0;
  const batch = { id: 'batch', nodes: [{ id: 'node' }], connections: [] }, errors = [];
  const { useCanvasNodeRecycle } = await load('画布回收/节点回收操作.ts', {
    react: hooks, '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => ({ openProject: () => ({ deletedNodeBatches: [batch] }) }) } },
    '@/services/image-storage': { collectImageStorageKeys: () => new Set(['image:missing']), getImageBlob: async () => null },
    '@/services/file-storage': { collectMediaStorageKeys: () => new Set(), getMediaBlob: async () => null },
    '@/lib/canvas/canvas-generation-helpers': {}, './画布节点回收': {},
    '../安全与批量/update-activity': { observeActivity: async (_kind, action) => action() },
    '../安全与批量/settle-activity-group': { settleActivityGroup: values => Promise.all(values) },
    '../产品/产品操作': { saveProductCanvas: async () => { updated++; } },
  });
  const historyRef = { current: { past: [], future: [] } };
  const api = useCanvasNodeRecycle({ projectId: 'product', nodesRef: { current: [] }, historyRef, lastHistoryRef: { current: null },
    assertImportTarget: () => {}, applyHistory: () => { applied++; }, updateProject: () => { updated++; },
    message: { error: value => errors.push(value) },
  });
  await api.restoreDeletedNodeBatch('batch');
  assert.equal(applied, 0); assert.equal(updated, 0); assert.equal(batch.nodes.length, 1);
  assert.deepEqual(historyRef.current, { past: [], future: [] });
  assert.match(errors[0], /图片素材缺失/);
});

async function batchModule(generationParameters = { promptGenerationPatch: () => ({}), generationSettingsFromNode: () => ({ quality: 'high' }) }) {
  const layout = await load('画布布局/卡片自动避让.ts', {});
  const columns = await load('画布布局/批量结果排布.ts', { './卡片自动避让': layout });
  const batchSave = await load('画布生成/批量保存协调.ts', {});
  const module = await load('画布生成/批量生成操作.ts', {
    react: hooks, '@/types/canvas': { CanvasNodeType: { Config: 'config', Text: 'text', Image: 'image', Video: 'video', Audio: 'audio' } },
    '@/constant/canvas': { getNodeSpec: () => ({ width: 100, height: 80 }) },
    '@/lib/canvas/canvas-node-factory': { createCanvasNode: (type, position, metadata) => ({ id: 'new-config', type, position, width: 100, height: 80, metadata: { status: 'idle', ...metadata } }) },
    '@/lib/canvas/canvas-generation-helpers': { getGenerationCount: value => value || 1 },
    nanoid: { nanoid: () => 'edge' },
    './生成参数继承': generationParameters,
    '../安全与批量/prompt-generation-mode': { promptGenerationMode: () => 'image' },
    '../安全与批量/settle-activity-group': { settleActivityGroup: values => Promise.all(values) },
    '../画布布局/卡片自动避让': { placeCanvasNode: node => node },
    '../画布布局/批量结果排布': columns,
    './批量保存协调': batchSave,
  });
  return { ...module, batchSave };
}
test('只补齐Excel提示词配置与连线不执行生成，也不把产品胶囊变绿', async () => {
  const parameters = await load('画布生成/生成参数继承.ts', {
    '@/types/canvas': { CanvasNodeType: { Config: 'config' } },
    '@/lib/canvas/canvas-generation-helpers': { getGenerationCount: value => value || 1 },
    '../安全与批量/prompt-generation-mode': { promptGenerationMode: () => 'image' },
  });
  const { useCanvasBatchGeneration } = await batchModule(parameters);
  const nodesRef = { current: [{ id: 'prompt', type: 'text', position: { x: 0, y: 0 }, width: 100, height: 80,
    metadata: { status: 'success', content: '900x1200 px, 3:4 MAIN IMAGE', generationImageType: 'main image' } }] };
  const connectionsRef = { current: [] };
  let submissions = 0;
  const api = useCanvasBatchGeneration({ projectId: 'product', nodesRef, connectionsRef, effectiveConfig: { imageModel: '模型', size: '1152x1536' },
    setNodes: () => {}, setConnections: () => {}, setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {},
    handleGenerateNode: async () => { submissions++; },
    message: { info: () => {}, success: () => {}, error: text => assert.fail(text) },
  });
  api.addGenerationConfigsForPromptNodes();
  assert.equal(submissions, 0);
  assert.equal(nodesRef.current.length, 2);
  assert.equal(connectionsRef.current.length, 1);
  assert.equal(nodesRef.current[1].metadata.generationImageType, 'main image');
  assert.equal(nodesRef.current[1].metadata.size, '900x1200');
  assert.deepEqual(canvasTaskSummary(nodesRef.current, connectionsRef.current), { status: 'idle', taskId: '', startedAt: 0 });
});
test('批量生图全部并行，失败继续，运行中卡片跳过且重复点击不重复排队', async () => {
  const { useCanvasBatchGeneration } = await batchModule();
  const gates = [], calls = [], warnings = [], placements = [];
  let active = 0, peak = 0;
  const nodesRef = { current: Array.from({ length: 6 }, (_, index) => ({ id: String(index), type: 'config', position: { x: 0, y: index * 400 }, width: 340, height: 240, metadata: { generationMode: 'image' } })) };
  nodesRef.current.push({ id: 'busy', type: 'config', metadata: { status: 'loading' } });
  const api = useCanvasBatchGeneration({ projectId: 'product', nodesRef, connectionsRef: { current: [] }, effectiveConfig: {},
    handleGenerateNode: async (id, _mode, _prompt, placement) => { placements.push(placement); calls.push(id); peak = Math.max(peak, ++active); await new Promise(done => gates.push(done)); active--; if (id === '1') throw Error('单项失败'); },
    message: { info: () => {}, warning: text => warnings.push(text) },
  });
  const first = api.generateAllConfigNodes();
  await api.generateAllConfigNodes();
  assert.equal(calls.length, 6);
  while (calls.length < 6) { gates.shift()(); await new Promise(done => setImmediate(done)); }
  while (gates.length) gates.shift()();
  await first;
  assert.equal(peak, 6); assert.equal(new Set(calls).size, 6); assert.ok(!calls.includes('busy'));
  assert.match(warnings[0], /1 个任务提交失败/);
  assert.equal(new Set(placements.map(item => item.columnX)).size, 1);
  assert.equal(new Set(placements.map(item => item.batchId)).size, 1);
  assert.ok(placements.every((item, index) => item.centerY === index * 400 + 120));
});
test('补齐并生成同步读取新配置，不依赖下一次React渲染', async () => {
  const { useCanvasBatchGeneration } = await batchModule();
  const nodesRef = { current: [{ id: 'prompt', type: 'text', position: { x: 0, y: 0 }, width: 100, height: 80, metadata: { content: '提示词' } }] };
  const connectionsRef = { current: [] }, generated = [];
  const api = useCanvasBatchGeneration({ projectId: 'product', nodesRef, connectionsRef, effectiveConfig: { imageModel: '模型', size: '900x1200' },
    setNodes: () => {}, setConnections: () => {}, setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {},
    handleGenerateNode: async id => { assert.ok(connectionsRef.current.some(edge => edge.toNodeId === id)); generated.push(id); },
    message: { info: () => {}, success: () => {}, warning: () => {}, error: text => assert.fail(text) },
  });
  await api.completeAndGenerateAll();
  assert.deepEqual(generated, ['new-config']); assert.equal(nodesRef.current.length, 2);
  assert.equal(nodesRef.current[1].metadata.quality, 'high');
});

test('批量执行期间暂停自动整画布写入，结束后只提交一次最终快照', async () => {
  const { useCanvasBatchGeneration, batchSave } = await batchModule();
  const nodesRef = { current: [
    { id: 'a', type: 'config', position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { generationMode: 'image' } },
    { id: 'b', type: 'config', position: { x: 0, y: 400 }, width: 340, height: 240, metadata: { generationMode: 'image' } },
  ] };
  let finalSaves = 0;
  const api = useCanvasBatchGeneration({ projectId: 'product', nodesRef, connectionsRef: { current: [] }, effectiveConfig: {},
    setNodes: update => {
      nodesRef.current = typeof update === 'function' ? update(nodesRef.current) : update;
      if (batchSave.isBatchCanvasSaveActive('product')) batchSave.markBatchCanvasDirty('product');
    },
    setConnections: () => {}, setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {},
    handleGenerateNode: async () => {
      assert.equal(batchSave.isBatchCanvasSaveActive('product'), true);
      batchSave.markBatchCanvasDirty('product');
    },
    saveCanvas: async id => {
      assert.equal(id, 'product');
      // 最终快照写入期间仍保持门控，防止 React 订阅在这笔保存前后
      // 插入第二次普通 SQLite 写入；写入完成后才释放。
      assert.equal(batchSave.isBatchCanvasSaveActive(id), true);
      finalSaves++;
    },
    message: { info: () => {}, warning: () => {}, error: text => assert.fail(text) },
  });
  await api.generateAllConfigNodes();
  assert.equal(finalSaves, 1);
  assert.equal(batchSave.isBatchCanvasSaveActive('product'), false);
});

test('批量执行期间视频身份保存只标记脏状态，批量结束后才允许一次最终提交', async () => {
  const batchSave = await load('画布生成/批量保存协调.ts', {});
  let flushes = 0, sqliteFlushes = 0, openChecks = 0;
  const product = await load('产品/产品操作.ts', {
    react: { useCallback: fn => fn, useLayoutEffect() {}, useRef: value => ({ current: value }), useState: value => [value, () => {}], useSyncExternalStore: (_subscribe, get) => get() },
    'react-router-dom': { useMatch: () => null, useNavigate: () => () => {} },
    '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => ({ openProject: () => { openChecks++; return true; } }) } },
    '../画布导入/画布导入': { readCanvasExport: async () => ({}) },
    '../本机存储/上游浏览器存储桥': { flushSQLiteStorage: async () => { sqliteFlushes++; }, sqlitePreferences: {}, retrySQLiteStorage() {} },
    './产品规则': {
      ProductOperationGate: class {},
      ProductSaveRegistry: class { async flush() { flushes++; } },
      orderedProducts: () => [],
    },
    './产品保存检查点': { ProductCommitCheckpoint: class {} },
    './产品回收规则': { planProductRecycle: () => ({}), planProductRestore: () => ({}), recycledProducts: () => [] },
    '../Excel删除/工作簿删除规则': { planWorkbookDeletion: () => ({}), workbookDeletionIds: () => [] },
    '../Excel删除/工作簿删除门禁': { workbookDeletionGate: { getSnapshot: () => false, subscribe: () => () => {} } },
    '../Excel删除/Excel回收站规则': { planWorkbookPermanentDelete: () => ({}), planWorkbookRestore: () => ({}), recycledWorkbookEntries: () => [] },
    '../Excel/Excel保存导航': { commitWorkbookChange: async () => {} },
    '../Excel/Excel产品归属': {
      visibleWorkbookId: () => '', withVisibleSelection: value => value, planExcelImport: () => ({}),
      prepareWorkbookEntry: () => ({}), rememberWorkbookProduct: () => null,
      selectWorkbook: () => ({}), workbookEntry: () => null, workbookProjects: () => [],
    },
    '../Excel画布/产品参数卡片默认': { ensureProductParameterNode: nodes => nodes },
    './产品恢复挂载门禁': { productRestoreMountGate: { getSnapshot: () => [], release() {}, block() {} } },
    '../画布生成/批量保存协调': batchSave,
  });
  batchSave.beginBatchCanvasSave('product');
  await product.saveProductCanvas('product', { checkpoint: true });
  assert.equal(flushes, 0);
  assert.equal(sqliteFlushes, 0);
  assert.equal(openChecks, 0);
  assert.equal(batchSave.finishBatchCanvasSave('product'), true);
  batchSave.completeBatchCanvasSave('product');
  await product.saveProductCanvas('product', { force: true });
  assert.equal(flushes, 1);
  assert.equal(sqliteFlushes, 1);
  assert.equal(openChecks, 1);
});
