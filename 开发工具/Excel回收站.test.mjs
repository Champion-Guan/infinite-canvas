import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { ts } from './检查首批功能适配.mjs';

function load(source, imports = {}) {
  const context = vm.createContext({ exports: {}, require(name) {
    if (!(name in imports)) throw Error('测试拒绝未知导入：' + name);
    return imports[name];
  }, structuredClone, console });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context.exports;
}

const ownership = load(readFileSync(join(根目录, '扩展功能/Excel/Excel产品归属.ts'), 'utf8'), {
  './旧版Excel合同.js': { createEmptyWorkbook: () => ({ schema: 'guan-workbench.v1', version: 1, workspace: { activeProductSetId: null, activeProductId: null }, productSets: [], products: [], importRecords: [], slots: [], prompts: [], tasks: [], runs: [], providerAttempts: [], assets: [] }), importPromptProducts: () => { throw Error('不应在回收站测试中调用导入'); } },
  '../产品/旧版产品显示名.js': { productDisplayName: product => product.identity?.titleZh || product.title || '未命名产品' },
  '../图片设置/图片信息偏好': { imageInfoDefaults: { showImageInfo: false } },
});
const recycle = load(readFileSync(join(根目录, '扩展功能/Excel删除/Excel回收站规则.ts'), 'utf8'));
const deletion = load(readFileSync(join(根目录, '扩展功能/Excel删除/工作簿删除规则.ts'), 'utf8'), {
  '../Excel/Excel产品归属': ownership,
  './Excel回收站规则': recycle,
  '../产品/产品任务摘要.js': { canvasTaskSummary: () => ({ status: 'idle' }) },
  './旧版工作簿删除.js': { deleteLegacyWorkbook(state, id) {
    const ids = new Set(state.products.filter(item => item.productSetId === id).map(item => item.id));
    const taskIds = new Set((state.tasks || []).filter(row => ids.has(row.productId)).map(row => row.id));
    const runIds = new Set((state.runs || []).filter(row => ids.has(row.productId) || taskIds.has(row.taskId)).map(row => row.id));
    state.productSets = state.productSets.filter(item => item.id !== id);
    state.products = state.products.filter(item => !ids.has(item.id));
    state.importRecords = state.importRecords.filter(row => row.productSetId !== id);
    state.slots = state.slots.filter(row => !ids.has(row.productId));
    state.prompts = state.prompts.filter(row => !ids.has(row.productId));
    state.tasks = state.tasks.filter(row => !taskIds.has(row.id) && !ids.has(row.productId));
    state.runs = state.runs.filter(row => !runIds.has(row.id) && !taskIds.has(row.taskId) && !ids.has(row.productId));
    state.providerAttempts = state.providerAttempts.filter(row => !runIds.has(row.runId));
    state.assets = state.assets.filter(row => !runIds.has(row.runId) && !taskIds.has(row.taskId) && !ids.has(row.productId));
    state.workspace.activeProductSetId = null; state.workspace.activeProductId = null;
  } },
});
const project = (id, productSetId) => ({ id, productSetId, title: id, createdAt: '2026-01-01', updatedAt: '2026-01-01', nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } });
function state() {
  const book = { id: 'book-a', createdAt: '2026-01-01', updatedAt: '2026-01-01', productIds: ['product-a'], source: { fileName: '女装.xlsx', sheetName: '提示词', promptTemplates: [] } };
  const product = { id: 'product-a', productSetId: 'book-a', order: 1, sourceRowNumber: 2, identity: { titleZh: '女装' }, attributes: {}, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  return { projects: [project('product-a', 'book-a'), project('other', null)], deletedProjects: [], guanWorkbooks: {
    version: 1, activeByWorkbook: { 'book-a': 'product-a' }, contract: {
      schema: 'guan-workbench.v1', workspace: { activeProductSetId: 'book-a', activeProductId: 'product-a' }, productSets: [book], products: [product],
      importRecords: [{ id: 'import-a', productSetId: 'book-a' }], slots: [{ id: 'slot-a', productId: 'product-a' }], prompts: [{ id: 'prompt-a', productId: 'product-a' }],
      tasks: [{ id: 'task-a', productId: 'product-a', status: 'succeeded' }], runs: [{ id: 'run-a', productId: 'product-a', taskId: 'task-a', status: 'succeeded' }],
      providerAttempts: [{ id: 'attempt-a', runId: 'run-a', status: 'succeeded' }], assets: [{ id: 'asset-a', productId: 'product-a', taskId: 'task-a', runId: 'run-a' }],
    },
  } };
}

test('工作簿删除后进入独立 Excel 回收站，完整保留关联数据', () => {
  const original = state(), planned = recycle.planWorkbookRecycle(original, 'book-a', '2026-10-27T00:00:00.000Z');
  assert.equal(planned.entry.workbook.source.fileName, '女装.xlsx');
  assert.equal(planned.entry.projects[0].id, 'product-a');
  assert.equal(planned.entry.records.tasks[0].id, 'task-a');
  assert.equal(planned.recycledWorkbooks.length, 1);
});

test('实际工作簿删除规划同时发布回收站快照', () => {
  const result = deletion.planWorkbookDeletion(state(), 'book-a', 'product-a');
  assert.equal(result.state.guanWorkbooks.contract.productSets.length, 0);
  assert.equal(result.state.guanWorkbooks.recycledWorkbooks.length, 1);
  assert.equal(result.state.guanWorkbooks.recycledWorkbooks[0].records.assets[0].id, 'asset-a');
});

test('恢复回收站工作簿前检查ID，恢复后回到下拉列表和当前选择', () => {
  const original = state(), entry = recycle.planWorkbookRecycle(original, 'book-a', new Date().toISOString()).entry;
  const removed = { ...original, projects: [original.projects[1]], guanWorkbooks: { ...original.guanWorkbooks,
    contract: { ...original.guanWorkbooks.contract, productSets: [], products: [], importRecords: [], slots: [], prompts: [], tasks: [], runs: [], providerAttempts: [], assets: [], workspace: { activeProductSetId: null, activeProductId: null } },
    activeByWorkbook: {}, recycledWorkbooks: [entry],
  } };
  const restored = recycle.planWorkbookRestore(removed, 'book-a');
  assert.equal(restored.guanWorkbooks.contract.productSets[0].source.fileName, '女装.xlsx');
  assert.ok(restored.projects.some(item => item.id === 'product-a'));
  assert.equal(restored.guanWorkbooks.contract.workspace.activeProductSetId, 'book-a');
  const conflict = { ...removed, guanWorkbooks: { ...removed.guanWorkbooks, contract: { ...removed.guanWorkbooks.contract,
    productSets: [entry.workbook], products: entry.products, workspace: { activeProductSetId: 'book-a', activeProductId: 'product-a' } } } };
  assert.throws(() => recycle.planWorkbookRestore(conflict, 'book-a'), /相同工作簿/);
});

test('永久删除只移除回收站快照，不影响其他工作簿和产品回收站', () => {
  const original = state(), entry = recycle.planWorkbookRecycle(original, 'book-a', new Date().toISOString()).entry;
  const removed = { ...original, projects: [original.projects[1]], guanWorkbooks: { ...original.guanWorkbooks,
    contract: { ...original.guanWorkbooks.contract, productSets: [], products: [], importRecords: [], slots: [], prompts: [], tasks: [], runs: [], providerAttempts: [], assets: [], workspace: { activeProductSetId: null, activeProductId: null } },
    activeByWorkbook: {}, recycledWorkbooks: [entry],
  } };
  const next = recycle.planWorkbookPermanentDelete(removed, 'book-a');
  assert.equal(next.guanWorkbooks.recycledWorkbooks.length, 0);
  assert.equal(next.projects[0].id, 'other');
  assert.equal(next.deletedProjects.length, 0);
});

test('再次导入或切换工作簿不会丢失 Excel 回收站', () => {
  const source = readFileSync(join(根目录, '扩展功能/Excel/Excel产品归属.ts'), 'utf8');
  assert.match(source, /recycledWorkbooks:\s*snapshot\.guanWorkbooks\.recycledWorkbooks/);
});
