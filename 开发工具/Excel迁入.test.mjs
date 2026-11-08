import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { 根目录 } from './公共.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 读取Excel来源, 提取Excel旧模块 } from './预审Excel迁入.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';

const sources = 读取Excel来源(), snippets = 提取Excel旧模块(sources);
function load(source, imports = {}, extra = {}) {
  const context = vm.createContext({ exports: {}, require: name => {
    if (!(name in imports)) throw Error('测试未授权模块：' + name);
    return imports[name];
  }, structuredClone, crypto: webcrypto, console, ...extra });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
const vendor = vm.createContext({}); vm.runInContext(sources.get('public/assets/local-vendor/xlsx.full.min.js'), vendor);
const XLSX = vendor.XLSX;
const parser = load(snippets.parser), engine = load(snippets.contract), markup = load(snippets.markup);
const displayNames = load(readFileSync(join(根目录, '扩展功能/产品/旧版产品显示名.js'), 'utf8'));
const imageInfo = load(readFileSync(join(根目录, '扩展功能/图片设置/图片信息偏好.ts'), 'utf8'));
const parameterCard = {
  ensureProductParameterNode: nodes => nodes.some(node => node.type === 'guan:prompt-variables')
    ? nodes
    : [...nodes, { id: 'parameter-card', type: 'guan:prompt-variables', metadata: { status: 'success' } }],
};
const model = load(readFileSync(join(根目录, '扩展功能/Excel/Excel产品归属.ts'), 'utf8'), {
  '../产品/产品规则': load(readFileSync(join(根目录, '扩展功能/产品/产品规则.ts'), 'utf8')),
  './旧版Excel合同.js': engine,
  '../产品/旧版产品显示名.js': displayNames,
  '../图片设置/图片信息偏好': imageInfo,
  '../Excel画布/产品参数卡片默认': parameterCard,
});
const navigation = load(readFileSync(join(根目录, '扩展功能/Excel/Excel保存导航.ts'), 'utf8'));
const { ProductCommitCheckpoint } = load(readFileSync(join(根目录, '扩展功能/产品/产品保存检查点.ts'), 'utf8'), {}, { setTimeout, clearTimeout });
const reader = load(readFileSync(join(根目录, '扩展功能/Excel/Excel文件读取.ts'), 'utf8'), { './旧版Excel解析.js': parser }, { window: { XLSX } });
const clean = value => JSON.parse(JSON.stringify(value));
const template = (id, route, prompt = 'Create [NAME]') => ({ id, route, order: 1, sourceRowNumber: Number(id.replace(/\D/g, '')) + 2 || 2, prompts: { 'Main Prompt': prompt, 'Detail Prompt 01': 'Detail [NAME]' } });
const upload = (state, templates, fileName = 'A.xlsx', fileSha256 = 'a') => model.planExcelImport(state, { fileName, fileSha256, kind: 'xlsx', sheetName: 'Prompts', promptSheetName: 'Prompts', promptTemplates: templates });
const empty = () => ({ projects: [], deletedProjects: [], guanWorkbooks: null });
const makeProject = (id, more = {}) => ({ id, title: '未命名产品1', createdAt: '2026-01-01', updatedAt: '2026-01-01', nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, ...more });
const book = rows => { const value = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(value, XLSX.utils.aoa_to_sheet(rows), 'Prompts'); return value; };
const rows = [ ['Final English Prompts'], ['Order', 'Product route / core advantage', 'Main Prompt', 'Detail Prompt 01 | 900 x 1200 | 3:4'],
  [1, '产品 | 金属', 'Main [NAME]', 'Detail [SIZE]'], [2, '产品 | 塑料', 'Other [NAME]', 'Other [SIZE]'], ['Validation', '', 'explanation', 'explanation'] ];

test('本地库版本、版权头及原解析/重传函数确实来自锁定旧源码', () => {
  assert.equal(XLSX.version, '0.18.5');
  assert.match(sources.get('public/assets/local-vendor/xlsx.full.min.js').slice(0, 100), /SheetJS/);
  assert.ok(snippets.parser.includes(snippets.parserFunctions));
  assert.ok(snippets.contract.includes(snippets.contractFunctions));
  assert.ok(snippets.importer.includes('Never delete a removed product'));
});
test('识别实际Prompt矩阵、尺寸表头不变成1900、过滤末尾校验行', () => {
  const parsed = parser.parsePromptWorkbook(XLSX, book(rows));
  assert.equal(parsed.promptTemplates.length, 2);
  assert.deepEqual(clean(parsed.parsed.promptColumns), ['Main Prompt', 'Detail Prompt 01']);
  assert.equal(parsed.promptTemplates[0].sourceRowNumber, 3);
  assert.equal(parsed.promptTemplates[0].prompts['Detail Prompt 01'], 'Detail [SIZE]');
});
test('XLSX原生二进制写入读回后仍识别同样矩阵（纯内存合成，不读私人Excel）', () => {
  const bytes = XLSX.write(book(rows), { type: 'array', bookType: 'xlsx' });
  assert.equal(parser.parsePromptWorkbook(XLSX, XLSX.read(bytes, { type: 'array', cellDates: true })).promptTemplates.length, 2);
});
test('旧XLS二进制工作簿仍可读取', () => {
  const bytes = XLSX.write(book(rows), { type: 'array', bookType: 'biff8' });
  assert.equal(parser.parsePromptWorkbook(XLSX, XLSX.read(bytes, { type: 'array', cellDates: true })).promptTemplates.length, 2);
});
test('中文UTF-8 CSV保留产品路线、换行及占位变量', () => {
  const text = 'Order,Product route / core advantage,Main Prompt,Detail Prompt 01\n1,中文产品,主图 [NAME],尺寸 [SIZE]';
  const bytes = new TextEncoder().encode(text);
  const parsed = parser.parsePromptWorkbook(XLSX, XLSX.read(bytes, { type: 'array', codepage: 65001 }));
  assert.equal(parsed.promptTemplates[0].route, '中文产品');
  assert.equal(parsed.promptTemplates[0].prompts['Main Prompt'], '主图 [NAME]');
});
test('Data/竞品表不是导入产品来源，末尾真实提示词表优先', () => {
  const value = book(rows);
  XLSX.utils.book_append_sheet(value, XLSX.utils.aoa_to_sheet([['SKU', '标题', '链接'], ['S', '竞品', 'https://example.test']]), 'Data');
  const alternate = clean(rows); alternate[2][1] = '末尾产品';
  XLSX.utils.book_append_sheet(value, XLSX.utils.aoa_to_sheet(alternate), '视觉内容与AI提示词');
  assert.equal(parser.parsePromptWorkbook(XLSX, value).promptTemplates[0].route, '末尾产品');
  assert.throws(() => parser.parsePromptWorkbook(XLSX, { SheetNames: ['Data'], Sheets: { Data: value.Sheets.Data } }), /竞品参考/);
});
test('仅Order或伪提示词表头、空工作簿被拒绝', () => {
  assert.throws(() => parser.parsePromptWorkbook(XLSX, book([['Order', 'Main Prompt'], [1, 'one']])), /未找到/);
  assert.throws(() => parser.parsePromptWorkbook(XLSX, { SheetNames: [], Sheets: {} }), /没有工作表/);
});
test('200列和10000数据行上限仍生效', () => {
  const value = book(rows), p = parser.createExcelParser(XLSX);
  value.Sheets.Prompts['!ref'] = 'A1:GS10';
  assert.throws(() => p.parsePromptSheet(value, 'Prompts'), /200/);
  value.Sheets.Prompts['!ref'] = 'A1:D10004';
  assert.throws(() => p.parsePromptSheet(value, 'Prompts'), /10000/);
});
test('勾选后的模板才创建产品，保留原行号和17个旧默认任务位', () => {
  const parsed = parser.parsePromptWorkbook(XLSX, book(rows));
  const state = upload(empty(), [parsed.promptTemplates[1]]);
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].nodes.filter(node => node.type === 'guan:prompt-variables').length, 1);
  assert.equal(state.guanWorkbooks.contract.products[0].sourceRowNumber, 4);
  assert.equal(state.guanWorkbooks.contract.slots.length, 17);
  assert.equal(state.guanWorkbooks.contract.products[0].attributes['Detail Prompt 01'], 'Other [SIZE]');
  model.assertWorkbookSnapshot(state);
});
test('同名不同完整路线不合并，工作簿与产品一一归属', () => {
  const state = upload(empty(), [template('1', '同名 | 铝合金'), template('2', '同名 | 塑料')]);
  assert.equal(state.projects.length, 2);
  assert.equal(new Set(state.projects.map(p => p.id)).size, 2);
  assert.ok(state.projects.every(p => p.productSetId === state.guanWorkbooks.contract.productSets[0].id));
});
test('工作簿重传、行重排保留ID和画布引用，更新模板但不改生成结果', () => {
  let state = upload(empty(), [template('1', 'A'), template('2', 'B')]);
  const a = state.projects.find(p => p.title === 'A'), b = state.projects.find(p => p.title === 'B');
  const nodes = [{ id: 'original-image', metadata: { storageKey: 'kept' } }], connections = [{ id: 'line' }];
  state.projects = state.projects.map(p => p.id === a.id ? { ...p, nodes, connections } : p);
  state.guanWorkbooks = model.rememberWorkbookProduct(state, b.id);
  const after = upload(state, [template('2', 'B', 'new B'), template('1', 'A', 'new A'), template('3', 'C')], 'A.xlsx', 'changed');
  assert.equal(after.guanWorkbooks.contract.productSets.length, 1);
  assert.equal(after.projects.find(p => p.id === a.id).nodes, nodes);
  assert.equal(after.projects.find(p => p.id === a.id).connections, connections);
  assert.equal(after.guanWorkbooks.contract.products.find(p => p.id === a.id).attributes['Main Prompt'], 'new A');
  assert.equal(model.workbookEntry(after), b.id);
  assert.deepEqual(Array.from(model.orderedWorkbookProjects(after.projects, a.productSetId, after.guanWorkbooks.contract.products), p => p.title), ['B', 'A', 'C']);
  assert.equal(upload(after, [template('2', 'B'), template('1', 'A'), template('3', 'C')]).guanWorkbooks.contract.importRecords.length, 3);
});
test('移除产品行保留其画布、连线、任务和媒体，不执行删除', () => {
  const state = upload(empty(), [template('1', 'A'), template('2', 'B')]);
  const after = upload(state, [template('1', 'A')], 'A.xlsx', 'changed');
  assert.equal(after.projects.length, 2);
  assert.equal(after.guanWorkbooks.contract.productSets[0].productIds.length, 2);
});
test('人工重命名保留；未改名的产品继续同步Excel标题', () => {
  const state = upload(empty(), [template('1', 'A'), template('2', 'B')]);
  const first = state.projects.find(p => p.title === 'A'); first.title = '客户自定义标题';
  const after = upload(state, [template('1', 'Changed A'), template('2', 'Changed B')], 'A.xlsx', 'new');
  assert.equal(after.projects.find(p => p.id === first.id).title, '客户自定义标题');
  assert.ok(after.projects.some(p => p.title === 'Changed B'));
});
test('保存失败后再从旧页面操作，归属使用实际页面而非未确认的目的工作簿', () => {
  const a = upload(empty(), [template('1', 'A')]);
  const b = upload(a, [template('1', 'B')], 'B.xlsx', 'b');
  const restored = model.withVisibleSelection(b, a.projects[0].id);
  assert.equal(model.currentWorkbookId(restored.guanWorkbooks), a.projects[0].productSetId);
  assert.equal(model.workbookEntry(restored), a.projects[0].id);
});
test('不同工作簿同名产品仍隔离，每工作簿记住选择、空工作簿不串产品', () => {
  let state = upload(empty(), [template('1', 'A1'), template('2', 'A2')]);
  const ownerA = state.guanWorkbooks.contract.workspace.activeProductSetId, a = state.projects.find(p => p.title === 'A2');
  state.guanWorkbooks = model.rememberWorkbookProduct(state, a.id);
  state = upload(state, [template('1', 'A1')], 'B.xlsx', 'b');
  const ownerB = state.guanWorkbooks.contract.workspace.activeProductSetId;
  assert.notEqual(ownerA, ownerB);
  assert.equal(model.workbookProjects(state.projects, ownerB).length, 1);
  state.guanWorkbooks = model.selectWorkbook(state, ownerA);
  assert.equal(model.workbookEntry(state), a.id);
  assert.equal(model.workbookEntry({ ...state, projects: state.projects.filter(p => p.productSetId !== ownerA) }), null);
});
test('实际路由仍指向旧产品时，保存中的新工作簿不得抢走可见胶囊', () => {
  const first = upload(empty(), [template('1', 'A')]), a = first.projects[0];
  const after = upload(first, [template('1', 'B')], 'B.xlsx', 'b');
  assert.equal(model.visibleWorkbookId(after, a.id), a.productSetId);
  assert.notEqual(model.currentWorkbookId(after.guanWorkbooks), a.productSetId);
});
test('回收产品不会因重传复活，归档快照保留', () => {
  const state = upload(empty(), [template('1', 'A')]), project = state.projects[0];
  const archived = { ...state, projects: [], deletedProjects: [{ id: project.id, deletedAt: 'today', project }] };
  const after = upload(archived, [template('1', 'A')]);
  assert.equal(after.projects.length, 0);
  assert.equal(after.deletedProjects, archived.deletedProjects);
  model.assertWorkbookSnapshot(after);
});
test('缺失归属字段只收编一次，显式null不收编、不跨工作簿重新归属', () => {
  const state = upload({ ...empty(), projects: [makeProject('legacy'), makeProject('unbound', { productSetId: null })] }, [template('1', 'A')]);
  const owner = state.projects.find(p => p.id === 'legacy').productSetId;
  const after = upload(state, [template('1', 'B')], 'B.xlsx', 'b');
  assert.equal(after.projects.find(p => p.id === 'legacy').productSetId, owner);
  assert.equal(after.projects.find(p => p.id === 'unbound').productSetId, null);
});
test('跨工作簿的过期偏好不导致串页，旧全局选择仅在正确归属中回退', () => {
  const state = upload(empty(), [template('1', 'A')]);
  state.guanWorkbooks.activeByWorkbook[state.projects[0].productSetId] = 'deleted';
  assert.equal(model.workbookEntry(state), state.projects[0].id);
  const old = { ...empty(), projects: [makeProject('one'), makeProject('two')] };
  assert.equal(model.workbookEntry(old, undefined, 'two'), 'two');
});
test('损坏工作簿/归属数据拒绝，不悄悄清空', () => {
  for (const mutate of [s => { s.guanWorkbooks.version = 99; }, s => { s.guanWorkbooks.contract.productSets = {}; }, s => { s.projects[0].productSetId = 'missing'; }, s => { s.guanWorkbooks.contract.products[0].productSetId = 'missing'; }]) {
    const state = upload(empty(), [template('1', 'A')]); mutate(state);
    assert.throws(() => model.assertWorkbookSnapshot(state), /异常/);
  }
});
test('HTML里的文件名/路线/提示词全转义，不执行Excel中的HTML', () => {
  const html = markup.excelImportMarkup({ fileName: '<img src=x onerror=bad()>', sheetName: '<script>bad()</script>', promptTemplates: [template('1', '<b>fake</b>', '<svg onload=bad()>')], selectedPromptIndexes: [0] });
  assert.ok(!html.includes('<b>fake</b>')); assert.ok(!html.includes('<svg onload='));
  assert.match(html, /&lt;img/); assert.match(html, /导入 1 个产品/);
});
for (const failure of ['commit', 'flush', 'navigate']) test(`保存导航故障 ${failure} 不越过失败步骤`, async () => {
  const calls = [], state = { committed: true };
  const step = name => async () => { calls.push(name); if (name === failure) throw Error(name); };
  await assert.rejects(navigation.commitWorkbookChange({ commitCurrent: step('commit'),
    plan: () => { calls.push('plan'); return state; }, publish: value => { assert.equal(value, state); calls.push('publish'); }, flush: step('flush'), navigate: step('navigate') }), new RegExp(failure));
  assert.deepEqual(calls, failure === 'commit' ? ['commit'] : failure === 'flush' ? ['commit', 'plan', 'publish', 'flush'] : ['commit', 'plan', 'publish', 'flush', 'navigate']);
});
test('保存完成后再读最新根、发布整份关联并导航', async () => {
  let value = 1;
  await navigation.commitWorkbookChange({ commitCurrent: async () => { value = 2; }, plan: () => value,
    publish: next => assert.equal(next, 2), flush: async () => { value = 3; }, navigate: async () => assert.equal(value, 3) });
});
test('画布延后保存必须等统一SQLite ACK后才跳过重复检查点写入', async () => {
  const requested = [], writes = [], checkpoint = new ProductCommitCheckpoint(ticket => requested.push(ticket));
  checkpoint.mount();
  const initial = { value: 1 }, changed = { value: 2 };
  checkpoint.commit(0, initial, true);
  checkpoint.commit(0, changed, true);
  const commitOnce = async () => {
    const pending = checkpoint.flush(async value => writes.push(value), { deferSQLiteFlush: true });
    checkpoint.commit(requested.at(-1), changed, true);
    await pending;
  };
  await commitOnce();
  assert.deepEqual(writes, [changed]);
  await commitOnce();
  assert.deepEqual(writes, [changed, changed], '尚未收到最终ACK时应保留未保存修订');
  checkpoint.acknowledgeDeferredSave();
  const tickets = requested.length;
  await checkpoint.flush(async value => writes.push(value));
  assert.equal(requested.length, tickets);
  assert.deepEqual(writes, [changed, changed]);
  checkpoint.unmount();
});
test('工作簿入口准备同步记住目标产品，空工作簿清除活动产品', () => {
  const first = upload(empty(), [template('1', 'A')]);
  const second = upload(first, [template('1', 'B')], 'B.xlsx', 'b');
  const target = second.projects.find(project => project.title === 'B');
  const selected = { ...second, guanWorkbooks: model.selectWorkbook(second, target.productSetId) };
  const prepared = model.prepareWorkbookEntry(selected);
  assert.equal(prepared.guanWorkbooks.contract.workspace.activeProductSetId, target.productSetId);
  assert.equal(prepared.guanWorkbooks.contract.workspace.activeProductId, target.id);
  assert.equal(prepared.guanWorkbooks.activeByWorkbook[target.productSetId], target.id);
  const emptyBook = { ...selected, projects: selected.projects.filter(project => project.productSetId !== target.productSetId),
    guanWorkbooks: model.selectWorkbook(selected, target.productSetId) };
  assert.equal(model.prepareWorkbookEntry(emptyBook).guanWorkbooks.contract.workspace.activeProductId, null);
});
test('文件读取报告阶段进度和SHA-256，不读取远程内容', async () => {
  const bytes = XLSX.write(book(rows), { type: 'array', bookType: 'xlsx' }), stages = [];
  const value = await reader.readExcelFile({ name: '测试.xlsx', size: bytes.byteLength, arrayBuffer: async () => bytes }, new AbortController().signal, next => stages.push(next.progress));
  assert.equal(value.promptTemplates.length, 2);
  assert.match(value.fileSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(stages, [4, 18, 42, 68, 88]);
});
test('非法扩展名、超100MB文件在读取前拒绝', async () => {
  for (const file of [{ name: 'bad.exe', size: 1 }, { name: 'large.xlsx', size: 101 * 1024 * 1024 }])
    await assert.rejects(reader.readExcelFile({ ...file, arrayBuffer: assert.fail }, new AbortController().signal, () => {}), /请选择|超过/);
});
test('取消解析后，晚到文件不会成为新的导入预览', async () => {
  let resolve;
  const controller = new AbortController(), promise = reader.readExcelFile({ name: 'slow.xlsx', size: 1, arrayBuffer: () => new Promise(done => { resolve = done; }) }, controller.signal, () => {});
  controller.abort(); resolve(new ArrayBuffer(1));
  await assert.rejects(promise, /abort/i);
});
test('工作簿关联和产品同一个SQLite分片根落盘，冷重开不丢归属或选择', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'guan-excel-storage-test-'));
  let workspace = openWorkspace({ dataRoot, initialize: true });
  const client = { readDocument: async (...args) => workspace.readDocument(...args), writeDocument: async input => workspace.writeDocument(input) };
  let app = createRecoverableShardedApplicationStorage({ client });
  try {
    const state = upload(empty(), [template('1', 'A'), template('2', 'B')]);
    state.guanWorkbooks = model.rememberWorkbookProduct(state, state.projects[1].id);
    const payload = JSON.stringify({ state, version: 0 });
    await app.createInstance({ storeName: 'app_state' }).setItem('infinite-canvas:canvas_store', payload); await app.flush();
    app.close(); workspace.close(); workspace = openWorkspace({ dataRoot });
    app = createRecoverableShardedApplicationStorage({ client });
    const read = await app.createInstance({ storeName: 'app_state' }).getItem('infinite-canvas:canvas_store');
    assert.equal(read, payload); model.assertWorkbookSnapshot(JSON.parse(read).state);
  } finally { app.close(); workspace.close(); rmSync(dataRoot, { recursive: true, force: true }); }
});
test('当前装配入口保留工作簿持久化与恢复门禁，旧存储及全局DOM桥未被带入', () => {
  const module = readFileSync(join(根目录, '扩展功能/Excel/旧版Excel合同.js'), 'utf8');
  const executable = ts.transpileModule(module, { compilerOptions: { removeComments: true } }).outputText;
  assert.doesNotMatch(executable, /localStorage|sessionStorage|MutationObserver|window\./);
  const store = readFileSync(join(根目录, '.运行/3100源/画布副本/web/src/stores/canvas/use-canvas-store.ts'), 'utf8');
  assert.match(store, /guanWorkbooks: state.guanWorkbooks/);
  assert.match(store, /queuedPersistState.guanWorkbooks === nextState.guanWorkbooks/);
  const entry = readFileSync(join(根目录, '扩展功能/产品配置/画布入口.tsx'), 'utf8');
  assert.match(entry, /!productRestoreMountGate.getSnapshot\(\).includes\(id\)/);
  assert.equal(readFileSync(join(根目录, '界面资源/运行资源/guan/Excel/xlsx.full.min.js'), 'utf8'), sources.get('public/assets/local-vendor/xlsx.full.min.js'));
});

const newImport = () => ({ fileName: 'B.xlsx', kind: 'xlsx', fileSha256: 'b', sheetName: 'Prompts', promptSheetName: 'Prompts', promptTemplates: [template('1', 'B')] });
async function until(predicate) {
  for (let count = 0; count < 50 && !predicate(); count++) await Promise.resolve();
  assert.ok(predicate(), '没有到达预期异步检查点');
}

// 直接执行根目录现用操作、保存注册表和回收规则；React调度、路由与磁盘ACK为替身。
function rootProductOperationHarness(initial, activeId) {
  const gateModule = load(readFileSync(join(根目录, '扩展功能/产品/产品恢复挂载门禁.ts'), 'utf8'));
  const gate = gateModule.productRestoreMountGate;
  let state = { ...initial, hydrated: true }, route = activeId, flushCount = 0, commitCount = 0, created = 0;
  let control = async () => {};
  const events = [], paths = [], preferences = new Map([['guan-products:active:v1', activeId]]), flushSnapshots = [];
  const store = selector => selector(state);
  store.setState = patch => { state = { ...state, ...patch }; events.push({ kind: 'publish', blocked: [...gate.getSnapshot()] }); };
  store.getState = () => ({ ...state, openProject: id => state.projects.find(project => project.id === id) ?? null,
    updateProject: (id, patch) => store.setState({ projects: state.projects.map(project => project.id === id ? { ...project, ...patch } : project) }),
    createProject: () => { const id = `manual-${++created}`; store.setState({ projects: [makeProject(id, { productSetId: model.currentWorkbookId(state.guanWorkbooks) }), ...state.projects] }); return id; } });
  const checkpointOptions = []; let checkpointAcknowledgements = 0;
  class Checkpoint {
    mount() {}
    unmount() {}
    commit() {}
    async flush(persist, options) { commitCount++; checkpointOptions.push(options ?? {}); await persist({ projectId: activeId, nodes: [] }); }
    acknowledgeDeferredSave() { checkpointAcknowledgements++; }
  }
  const rules = load(readFileSync(join(根目录, '扩展功能/产品/产品规则.ts'), 'utf8'));
  const recycle = load(readFileSync(join(根目录, '扩展功能/产品/产品回收规则.ts'), 'utf8'), {
    './产品任务摘要.js': load(readFileSync(join(根目录, '扩展功能/产品/产品任务摘要.js'), 'utf8')), './产品规则': rules,
  });
  const bridge = {
    flushSQLiteStorage: async () => {
      const count = ++flushCount;
      flushSnapshots.push({ count, owner: model.currentWorkbookId(state.guanWorkbooks), activeProductId: state.guanWorkbooks?.contract.workspace.activeProductId,
        activePreference: preferences.get('guan-products:active:v1') ?? null, route });
      events.push({ kind: 'flush', count });
      await control(count);
      events.push({ kind: 'ack', count });
    },
    sqlitePreferences: { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value), removeItem: key => preferences.delete(key) },
  };
  const noOpGate = { subscribe: () => () => {}, getSnapshot: () => '' };
  const source = readFileSync(join(根目录, '扩展功能/产品/产品操作.ts'), 'utf8');
  const operations = load(source, {
    react: { useCallback: callback => callback, useSyncExternalStore: (_subscribe, read) => read(), useRef: value => ({ current: value }),
      useState: value => [value, () => {}], useLayoutEffect: effect => effect() },
    'react-router-dom': { useMatch: () => route ? { params: { id: route } } : null,
      useNavigate: () => (path, options) => { paths.push({ path, options }); route = path.startsWith('/canvas/') ? decodeURIComponent(path.slice(8)) : ''; events.push({ kind: 'navigate', blocked: [...gate.getSnapshot()] }); } },
    '@/stores/canvas/use-canvas-store': { useCanvasStore: store },
    '../画布导入/画布导入': { readCanvasExport: async () => [] },
    '../本机存储/上游浏览器存储桥': bridge,
    './产品规则': rules,
    './产品保存检查点': { ProductCommitCheckpoint: Checkpoint },
    './产品回收规则': recycle, '../Excel删除/工作簿删除规则': {}, '../Excel删除/工作簿删除门禁': { workbookDeletionGate: noOpGate },
    '../Excel删除/Excel回收站规则': { planWorkbookPermanentDelete: value => value, planWorkbookRestore: value => value, recycledWorkbookEntries: () => [] },
    '../Excel/Excel保存导航': navigation,
    '../Excel/Excel产品归属': model,
    '../Excel画布/产品参数卡片默认': parameterCard,
    './产品恢复挂载门禁': gateModule,
    '../画布生成/批量保存协调': { isBatchCanvasSaveActive: () => false, markBatchCanvasDirty: () => {}, withBatchCanvasCheckpoint: (_id, run) => run() },
  }, { window: { matchMedia: () => ({ matches: true }) } });
  operations.useProductCanvasSave(activeId, {}, () => true, async () => {});
  return { nav: () => operations.useProductNavigation(), state: () => state, gate, events, paths, preferences, flushSnapshots,
    checkpointOptions, checkpointAcknowledgements: () => checkpointAcknowledgements,
    control: value => { control = value; }, flushCount: () => flushCount, commitCount: () => commitCount };
}

test('真实工作簿切换把根和偏好合并为一次最终ACK，ACK前不导航', async () => {
  const first = upload(empty(), [template('1', 'A')]), old = first.projects[0];
  const initial = upload(first, [template('1', 'B')], 'B.xlsx', 'b');
  const target = initial.projects.find(project => project.title === 'B'), book = initial.guanWorkbooks.contract.productSets.find(item => item.id === target.productSetId);
  const h = rootProductOperationHarness(initial, old.id);
  let release;
  h.control(count => count === 1 ? new Promise(resolve => { release = resolve; }) : undefined);
  const operation = h.nav().selectWorkbook(book.id);
  await until(() => h.flushCount() === 1);
  assert.equal(h.commitCount(), 1);
  assert.equal(h.checkpointOptions[0].deferSQLiteFlush, true, '画布检查点只准备快照，由统一工作簿ACK确认');
  assert.deepEqual(h.paths, []);
  assert.equal(h.flushSnapshots[0].owner, book.id);
  assert.equal(h.flushSnapshots[0].activeProductId, target.id);
  assert.equal(h.flushSnapshots[0].activePreference, target.id);
  release(); await operation;
  assert.equal(h.checkpointAcknowledgements(), 1, 'SQLite ACK 后才将待确认画布修订标记为已保存');
  assert.deepEqual(h.paths.map(item => item.path), ['/canvas/' + target.id]);
  assert.equal(h.flushCount(), 1, '切换只执行一轮最终SQLite确认');
});

test('合并后的最终ACK失败时不导航并恢复原活动产品偏好', async () => {
  const first = upload(empty(), [template('1', 'A')]), old = first.projects[0];
  const initial = upload(first, [template('1', 'B')], 'B.xlsx', 'b');
  const target = initial.projects.find(project => project.title === 'B'), book = initial.guanWorkbooks.contract.productSets.find(item => item.id === target.productSetId);
  const h = rootProductOperationHarness(initial, old.id);
  h.control(count => { if (count === 1) throw new Error('SQLite ACK 失败'); });
  await assert.rejects(h.nav().selectWorkbook(book.id), /SQLite ACK 失败/);
  assert.equal(h.checkpointAcknowledgements(), 0, 'ACK失败时不能把画布检查点标记为已保存');
  assert.deepEqual(h.paths, []);
  assert.equal(h.preferences.get('guan-products:active:v1'), old.id);
  assert.equal(model.visibleWorkbookId(h.state(), old.id), old.productSetId);
});

test('当前导入：画布检查点与工作簿根统一ACK前不导航、不释放新产品挂载门禁', async () => {
  const initial = upload(empty(), [template('1', 'A')]), old = initial.projects[0];
  const h = rootProductOperationHarness(initial, old.id);
  let release;
  h.control(count => count === 1 ? new Promise(resolve => { release = resolve; }) : undefined);
  const operation = h.nav().importWorkbook(newImport());
  await until(() => h.flushCount() === 1);
  const added = h.state().projects.find(project => project.title === 'B');
  assert.equal(h.commitCount(), 1); assert.ok(h.gate.getSnapshot().includes(added.id)); assert.deepEqual(h.paths, []);
  assert.equal(h.state().projects.find(project => project.id === old.id), old);
  release(); await operation;
  assert.equal(h.flushCount(), 1);
  assert.deepEqual(h.paths.map(item => item.path), ['/canvas/' + added.id]); assert.deepEqual(Array.from(h.gate.getSnapshot()), []);
  assert.ok(h.events.find(event => event.kind === 'navigate').blocked.includes(added.id));
});
test('当前导入统一ACK失败：保留新工作簿与原画布，不跳页，可显式选择后重试', async () => {
  const initial = upload(empty(), [template('1', 'A')]), old = initial.projects[0];
  const h = rootProductOperationHarness(initial, old.id);
  h.control(() => { throw Error('模拟SQLite拒绝'); });
  await assert.rejects(h.nav().importWorkbook(newImport()), /SQLite拒绝/);
  const added = h.state().projects.find(project => project.title === 'B');
  assert.equal(h.state().guanWorkbooks.contract.productSets.length, 2);
  assert.equal(h.state().projects.find(project => project.id === old.id), old);
  assert.deepEqual(h.paths, []); assert.ok(h.gate.getSnapshot().includes(added.id));
  assert.equal(h.preferences.get('guan-products:active:v1'), old.id);
  assert.equal(model.visibleWorkbookId(h.state(), old.id), old.productSetId);
  h.control(async () => {}); await h.nav().selectWorkbook(added.productSetId);
  assert.equal(h.state().projects.length, 2); assert.equal(h.state().guanWorkbooks.contract.productSets.length, 2);
  assert.deepEqual(h.paths.map(item => item.path), ['/canvas/' + added.id]); assert.deepEqual(Array.from(h.gate.getSnapshot()), []);
});
test('当前操作并发门禁拒绝第二次导入，不重复创建产品', async () => {
  const initial = upload(empty(), [template('1', 'A')]), h = rootProductOperationHarness(initial, initial.projects[0].id);
  let release;
  h.control(count => count === 1 ? new Promise(resolve => { release = resolve; }) : undefined);
  const first = h.nav().importWorkbook(newImport());
  await until(() => h.flushCount() === 1);
  await assert.rejects(h.nav().importWorkbook(newImport()), /另一个产品操作/);
  release(); await first; assert.equal(h.state().projects.length, 2);
});
test('当前操作拒绝跨工作簿的过期胶囊点击', async () => {
  const a = upload(empty(), [template('1', 'A')]), both = upload(a, [template('1', 'B')], 'B.xlsx', 'b');
  const h = rootProductOperationHarness(both, a.projects[0].id), target = both.projects.find(project => project.title === 'B');
  await assert.rejects(h.nav().selectProduct(target.id), /不属于当前工作表/);
  assert.equal(h.flushCount(), 0); assert.deepEqual(h.paths, []);
});
test('当前操作保存失败后新建产品仍归属当前实际页面的工作簿', async () => {
  const initial = upload(empty(), [template('1', 'A')]), old = initial.projects[0], h = rootProductOperationHarness(initial, old.id);
  h.control(count => { if (count === 1) throw Error('模拟失败'); });
  await assert.rejects(h.nav().importWorkbook(newImport()), /模拟失败/);
  h.control(async () => {}); const id = await h.nav().createProduct();
  assert.equal(h.state().projects.find(project => project.id === id).productSetId, old.productSetId);
  assert.equal(h.state().projects.find(project => project.id === id).nodes.filter(node => node.type === 'guan:prompt-variables').length, 1);
  assert.equal(model.currentWorkbookId(h.state().guanWorkbooks), old.productSetId);
});
test('当前操作删除本工作簿最后产品回首页，不跳到另一工作簿', async () => {
  const a = upload(empty(), [template('1', 'A')]), both = upload(a, [template('1', 'B')], 'B.xlsx', 'b');
  const target = both.projects.find(project => project.title === 'B'), h = rootProductOperationHarness(both, target.id);
  await h.nav().recycleProduct(target.id);
  assert.deepEqual(h.paths.map(item => item.path), ['/']); assert.equal(model.workbookEntry(h.state()), null);
  assert.equal(h.state().projects[0].id, a.projects[0].id);
});
