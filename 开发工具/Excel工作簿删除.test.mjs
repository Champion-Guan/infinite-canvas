import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { 根目录 } from './公共.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 构建工作簿删除候选, 提取旧工作簿删除 } from './预审Excel工作簿删除.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';

function load(source, imports = {}, globals = {}) {
  const context = vm.createContext({ exports: {}, require(name) {
    if (!(name in imports)) throw Error('测试拒绝未知导入：' + name);
    return imports[name];
  }, structuredClone, console, ...globals });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context.exports;
}
const clean = value => JSON.parse(JSON.stringify(value));
const own = file => readFileSync(join(根目录, '扩展功能/Excel删除', file), 'utf8');
const preview = 构建工作簿删除候选();
const legacy = load(preview.legacyModule);
const ownership = load(readFileSync(join(preview.integration.副本, 'web/src/guan/Excel产品归属.ts'), 'utf8'), { './旧版Excel合同.js': {} });
const summary = load(readFileSync(join(preview.integration.副本, 'web/src/guan/产品任务摘要.js'), 'utf8'));
const domain = load(own('工作簿删除规则.ts'), { './Excel产品归属': ownership, './产品任务摘要.js': summary, './旧版工作簿删除.js': legacy });
const { WorkbookDeletionGate } = load(own('工作簿删除门禁.ts'));
const project = (id, owner) => ({ id, productSetId: owner, title: id, createdAt: '2026-01-01', updatedAt: '2026-01-01', nodes: [], connections: [], chatSessions: [], activeChatId: null, viewport: { x: 0, y: 0, k: 1 } });
function state() {
  const product = (id, owner) => ({ id, productSetId: owner, order: 1, identity: { titleZh: id }, attributes: {} });
  const book = (id, createdAt) => ({ id, createdAt, updatedAt: createdAt, productIds: [id + '1'], source: { fileName: '同名.xlsx', promptTemplates: [] } });
  return { projects: [project('a1', 'a'), project('a2', 'a'), project('b1', 'b'), project('free', null)], deletedProjects: [],
    guanWorkbooks: { version: 1, activeByWorkbook: { a: 'a2', b: 'b1', __unbound__: 'free' }, contract: {
      schema: 'guan-workbench.v1', workspace: { activeProductSetId: 'a', activeProductId: 'a2' },
      productSets: [book('a', '2026-01-01'), book('b', '2026-02-01')], products: [product('a1', 'a'), product('b1', 'b')],
      importRecords: [{ id: 'ia', productSetId: 'a' }, { id: 'ib', productSetId: 'b' }],
      slots: [{ id: 'sa', productId: 'a1' }, { id: 'sb', productId: 'b1' }],
      prompts: [{ id: 'pa', productId: 'a1' }, { id: 'pb', productId: 'b1' }],
      tasks: [{ id: 'ta', productId: 'a1', status: 'succeeded' }, { id: 'tb', productId: 'b1', status: 'queued' }],
      runs: [{ id: 'ra', taskId: 'ta', productId: 'a1', status: 'succeeded' }, { id: 'rb', taskId: 'tb', productId: 'b1', status: 'running' }],
      providerAttempts: [{ id: 'aa', runId: 'ra', status: 'succeeded' }, { id: 'ab', runId: 'rb', status: 'running' }],
      assets: [{ id: 'asset-a', productId: 'a1', taskId: 'ta', runId: 'ra' }, { id: 'asset-b', productId: 'b1', taskId: 'tb', runId: 'rb' }],
    } } };
}
test('旧级联删除函数体原文提取，不带事件/旧存储桥', () => {
  const extracted = 提取旧工作簿删除(preview.legacySource);
  assert.ok(extracted.module.includes(extracted.body));
  assert.equal(extracted.module, preview.legacyModule);
  assert.doesNotMatch(extracted.module, /localStorage|dispatchEvent|document\.|window\./);
  assert.match(preview.legacySource, /删除 Excel？/);
});
test('整批范围按稳定工作簿ID，包含自建产品，不按同名文件删除', () => {
  assert.deepEqual(clean(domain.workbookDeletionIds(state(), 'a')), ['a1', 'a2']);
  assert.throws(() => domain.workbookDeletionIds(state(), 'missing'), /不存在/);
  assert.throws(() => domain.workbookDeletionIds(state(), ''), /不存在/);
});
test('旧合同级联逐值一致，其他工作簿/未关联产品/原对象不变', () => {
  const s = state(), before = clean(s), expected = structuredClone(s.guanWorkbooks.contract);
  legacy.deleteLegacyWorkbook(expected, 'a');
  const result = domain.planWorkbookDeletion(s, 'a', 'a2');
  assert.deepEqual(clean(result.state.guanWorkbooks.contract), expected);
  assert.deepEqual(clean(result.state.projects.map(p => p.id)), ['b1', 'free']);
  assert.equal(result.state.projects[0], s.projects[2]);
  assert.deepEqual(clean(result.state.guanWorkbooks.activeByWorkbook), { b: 'b1', __unbound__: 'free' });
  assert.equal(result.navigate, true); assert.equal(result.workbookId, 'a');
  assert.deepEqual(clean(s), before); ownership.assertWorkbookSnapshot(result.state);
});
test('删除后台工作簿保持当前产品和选择记忆，不抢切画布', () => {
  const s = state(); s.guanWorkbooks.contract.workspace = { activeProductSetId: 'b', activeProductId: 'b1' };
  const result = domain.planWorkbookDeletion(s, 'a', 'b1');
  assert.equal(result.navigate, false);
  assert.deepEqual(clean(result.state.guanWorkbooks.contract.workspace), { activeProductSetId: 'b', activeProductId: 'b1' });
  assert.equal(result.state.guanWorkbooks.activeByWorkbook.b, 'b1');
});
test('删除最后工作簿允许回未关联产品，不生成新空产品', () => {
  const s = state(); s.guanWorkbooks.contract.productSets.splice(1); s.guanWorkbooks.contract.products.splice(1);
  s.projects = s.projects.filter(p => p.id !== 'b1'); delete s.guanWorkbooks.activeByWorkbook.b;
  for (const key of ['importRecords', 'slots', 'prompts', 'tasks', 'runs', 'providerAttempts', 'assets']) s.guanWorkbooks.contract[key] = [];
  const r = domain.planWorkbookDeletion(s, 'a', 'a1');
  assert.equal(r.state.guanWorkbooks.contract.workspace.activeProductSetId, null);
  assert.equal(ownership.workbookEntry(r.state), 'free');
  assert.equal(r.state.projects.length, 1);
});
test('相关产品已在回收站时阻止整批删除，不销毁恢复快照', () => {
  const s = state(); s.deletedProjects.push({ id: 'a1', project: s.projects[0], deletedAt: '2026-01-01' }); s.projects.shift();
  assert.throws(() => domain.planWorkbookDeletion(s, 'a', 'a2'), /回收站/);
  const marker = state(); marker.deletedProjects.push({ id: 'a1', deletedAt: '2026-01-01' });
  assert.throws(() => domain.planWorkbookDeletion(marker, 'a', 'a2'), /回收站/);
});
test('运行中节点、多图/多文本子任务及合同未决任务均拒绝', () => {
  for (const metadata of [{ status: 'loading' }, { status: 'success', images: [{ status: 'loading' }] }, { status: 'success', texts: [{ status: 'loading' }] }]) {
    const s = state(); s.projects[0].nodes = [{ id: 'n', type: 'image', metadata: { generationStartedAt: 1, ...metadata } }];
    assert.throws(() => domain.planWorkbookDeletion(s, 'a', 'a1'), /任务/);
  }
  for (const key of ['tasks', 'runs', 'providerAttempts']) for (const status of ['queued', 'running', 'loading', 'unknown-future']) {
    const s = state(); s.guanWorkbooks.contract[key][0].status = status;
    assert.throws(() => domain.planWorkbookDeletion(s, 'a', 'a1'), /任务|未决/);
  }
});
test('草稿和已完成任务可以删除，但不受其他工作簿运行任务影响', () => {
  const s = state(); s.guanWorkbooks.contract.tasks[0].status = 'draft';
  assert.doesNotThrow(() => domain.planWorkbookDeletion(s, 'a', 'a1'));
});
test('未来未知节点状态安全拒绝，不将无法确认的生成记录当成结束', () => {
  const s = state(); s.projects[0].nodes = [{ id: 'n', type: 'image', metadata: { status: 'queued-future' } }];
  assert.throws(() => domain.planWorkbookDeletion(s, 'a', 'a1'), /状态未决/);
});
test('损坏关联数组、重复ID及跨归属冲突安全拒绝，原根不变', () => {
  for (const mutate of [s => s.guanWorkbooks.contract.runs = null, s => s.projects.push({ ...s.projects[0] }), s => s.projects[0].productSetId = 'b', s => s.guanWorkbooks.contract.tasks[0] = null]) {
    const s = state(); mutate(s); const before = JSON.stringify(s);
    assert.throws(() => domain.planWorkbookDeletion(s, 'a', 'a1'));
    assert.equal(JSON.stringify(s), before);
  }
});
test('自建产品的旧合同外关联记录拒绝，避免画布删掉而记录残留', () => {
  for (const key of ['slots', 'prompts', 'tasks', 'runs', 'assets']) {
    const s = state(); s.guanWorkbooks.contract[key].push({ id: 'manual-record', productId: 'a2', status: 'succeeded' });
    const before = JSON.stringify(s);
    assert.throws(() => domain.planWorkbookDeletion(s, 'a', 'a1'), /旧合同不支持/);
    assert.equal(JSON.stringify(s), before);
  }
});
test('跨工作簿任务、Run、素材和产品ID的冲突均拒绝，不能借一条引用误删其他产品', () => {
  for (const mutate of [
    s => s.guanWorkbooks.contract.runs[0].productId = 'b1',
    s => s.guanWorkbooks.contract.assets[1].taskId = 'ta',
    s => s.guanWorkbooks.contract.providerAttempts[0].productId = 'b1',
    s => s.guanWorkbooks.contract.prompts[0].productSetId = 'b',
    s => s.projects[2].productSetId = 'a',
  ]) {
    const s = state(); mutate(s); const before = JSON.stringify(s);
    assert.throws(() => domain.planWorkbookDeletion(s, 'a', 'a1'), /冲突/);
    assert.equal(JSON.stringify(s), before);
  }
});
test('保留产品、任务、Run和素材来源不能悬空引用待删除记录', () => {
  for (const mutate of [
    s => s.guanWorkbooks.contract.products[1].sourceAssets = ['asset-a'],
    s => s.guanWorkbooks.contract.tasks[1].inputAssetIds = ['asset-a'],
    s => s.guanWorkbooks.contract.tasks[1].outputAssetIds = ['asset-a'],
    s => s.guanWorkbooks.contract.tasks[1].promptId = 'pa',
    s => s.guanWorkbooks.contract.tasks[1].activeRunId = 'ra',
    s => s.guanWorkbooks.contract.runs[1].attemptIds = ['aa'],
    s => s.guanWorkbooks.contract.assets[1].lineage = { parentAssetIds: ['asset-a'] },
  ]) {
    const s = state(); mutate(s); const before = JSON.stringify(s);
    assert.throws(() => domain.planWorkbookDeletion(s, 'a', 'a1'), /保留记录仍引用/);
    assert.equal(JSON.stringify(s), before);
  }
});
function harness(fail = '') {
  let s = state(); const events = [], gate = new WorkbookDeletionGate(); let fault = fail;
  const steps = {
    async commitCurrent() { events.push('checkpoint'); if (fault === 'checkpoint') throw Error('checkpoint'); },
    plan() { events.push('plan'); return domain.planWorkbookDeletion(s, 'a', 'a1'); },
    publish(value) { events.push('publish'); if (fault === 'publish') throw Error('publish'); s = value.state; },
    isPublished() { return !s.guanWorkbooks.contract.productSets.some(b => b.id === 'a'); },
    async flush() { events.push('flush'); if (fault === 'flush') throw Error('flush'); },
    async navigate() { events.push('navigate'); if (fault === 'navigate') throw Error('navigate'); },
  };
  return { gate, events, steps, state: () => s, clearFault: () => { fault = ''; } };
}
test('协调顺序为检查点、最新规划、一次发布、ACK、导航，最后放开门禁', async () => {
  const h = harness(), notifications = []; h.gate.subscribe(() => notifications.push(h.gate.getSnapshot()));
  await h.gate.run('a', h.steps);
  assert.deepEqual(h.events, ['checkpoint', 'plan', 'publish', 'flush', 'navigate']);
  assert.deepEqual(notifications, ['a', '']); assert.equal(h.gate.getSnapshot(), '');
});
test('检查点失败或未发布失败不删除根、不留下假待确认', async () => {
  for (const at of ['checkpoint', 'publish']) {
    const h = harness(at); await assert.rejects(h.gate.run('a', h.steps), new RegExp(at));
    assert.equal(h.gate.getSnapshot(), ''); assert.equal(h.state().projects.length, 4); assert.ok(!h.events.includes('navigate'));
  }
});
test('ACK失败保留门禁和完整待确认根，重试不重放旧快照覆盖晚到结果', async () => {
  const h = harness('flush'); await assert.rejects(h.gate.run('a', h.steps), /flush/);
  assert.equal(h.gate.getSnapshot(), 'a'); assert.ok(!h.events.includes('navigate'));
  h.state().projects[0].title = '后台已完成结果'; h.clearFault();
  await h.gate.run('a', h.steps);
  assert.equal(h.state().projects[0].title, '后台已完成结果');
  assert.equal(h.events.filter(v => v === 'publish').length, 1); assert.equal(h.gate.getSnapshot(), '');
});
test('导航失败后重试只确认并导航，其他工作簿操作不能抢占', async () => {
  const h = harness('navigate'); await assert.rejects(h.gate.run('a', h.steps), /navigate/);
  await assert.rejects(h.gate.run('b', h.steps), /未确认/);
  h.clearFault(); await h.gate.run('a', h.steps);
  assert.equal(h.events.filter(v => v === 'plan').length, 1); assert.equal(h.gate.getSnapshot(), '');
});
test('待确认期间第二调用被拒绝，门禁订阅卸载有效', async () => {
  const h = harness(); let release; let count = 0; const unsubscribe = h.gate.subscribe(() => count++);
  h.steps.flush = () => new Promise(resolve => { release = resolve; });
  const running = h.gate.run('a', h.steps); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(h.gate.run('a', h.steps), /进行/);
  unsubscribe(); release(); await running; assert.equal(count, 1);
});
// 实际候选产品操作模块的接口测试；React挂载/布局票据本身留给批准后的真实浏览器验收。
function navigationHarness(activeId = 'a1') {
  let current = state(); const events = [], cleanups = [], guards = { a1: true, b1: true };
  let failAck = false, onFlush = () => {};
  const store = { getState: () => current, setState(value) {
    events.push('publish'); current = { ...current, ...value };
  } };
  current.hydrated = true; current.openProject = id => current.projects.find(project => project.id === id);
  const rules = load(readFileSync(join(preview.integration.副本, 'web/src/guan/产品规则.ts'), 'utf8'));
  const preferences = new Map(), gate = new WorkbookDeletionGate();
  class Checkpoint {
    mount() {}
    unmount() {}
    commit(ticket, snapshot, ready) { this.snapshot = snapshot; this.ready = ready; }
    async flush(persist) { if (!this.ready) throw Error('not ready'); await persist(this.snapshot); }
  }
  const module = load(preview.delta.get('web/src/guan/产品操作.ts').产物, {
    react: { useCallback: fn => fn, useLayoutEffect: effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
      useRef: value => ({ current: value }), useState: value => [value, () => {}], useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot() },
    'react-router-dom': { useMatch: () => ({ params: { id: activeId } }), useNavigate: () => route => events.push('navigate:' + route) },
    '@/stores/canvas/use-canvas-store': { useCanvasStore: store },
    '@/guan/上游浏览器存储桥': {
      async flushSQLiteStorage() { events.push('flush'); onFlush(); if (failAck && !current.guanWorkbooks.contract.productSets.some(book => book.id === 'a')) throw Error('root ack failed'); },
      async retrySQLiteStorage() { events.push('retry'); },
      sqlitePreferences: { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value), removeItem: key => preferences.delete(key) },
    },
    './产品规则': rules, './产品保存检查点': { ProductCommitCheckpoint: Checkpoint }, './产品回收规则': {},
    './工作簿删除规则': domain, './工作簿删除门禁': { workbookDeletionGate: gate }, './Excel保存导航': {}, './Excel产品归属': ownership,
    './产品恢复挂载门禁': { productRestoreMountGate: { getSnapshot: () => [], release() {} } },
  }, { window: { matchMedia: () => ({ matches: true }) } });
  function mount(id) {
    module.useProductCanvasSave(id, current.projects.find(project => project.id === id), () => true,
      async () => { events.push('checkpoint:' + id); }, () => guards[id]);
  }
  return { events, guards, mount, state: () => current, navigation: module.useProductNavigation, gate,
    fault: value => { failAck = value; }, duringFlush: action => { onFlush = action; }, close: () => cleanups.reverse().forEach(cleanup => cleanup()) };
}
test('实际产品操作入口先保存当前和后台已挂载画布，再删除后台工作簿，不抢切产品', async () => {
  const h = navigationHarness('b1'); h.state().guanWorkbooks.contract.workspace = { activeProductSetId: 'b', activeProductId: 'b1' };
  h.mount('b1'); h.mount('a1');
  try {
    await h.navigation().deleteWorkbook('a');
    assert.deepEqual(h.events, ['checkpoint:b1', 'flush', 'checkpoint:a1', 'flush', 'publish', 'flush']);
    assert.equal(h.state().guanWorkbooks.contract.workspace.activeProductId, 'b1');
    assert.equal(h.gate.getSnapshot(), '');
  } finally { h.close(); }
});
test('实际入口检查点等待期间开始生成会阻止发布，保存前运行守卫也会拒绝', async () => {
  for (const before of [true, false]) {
    const h = navigationHarness(); h.mount('a1');
    if (before) h.guards.a1 = false;
    else h.duringFlush(() => { h.guards.a1 = false; });
    try {
      await assert.rejects(h.navigation().deleteWorkbook('a'), /生成任务运行中/);
      assert.ok(h.state().guanWorkbooks.contract.productSets.some(book => book.id === 'a'));
      assert.ok(!h.events.includes('publish')); assert.equal(h.gate.getSnapshot(), '');
    } finally { h.close(); }
  }
});
test('实际入口根ACK失败后全局busy持续，禁止其他操作；重试保留晚到编辑且不重放删除根', async () => {
  const h = navigationHarness(); h.mount('a1'); h.fault(true);
  try {
    await assert.rejects(h.navigation().deleteWorkbook('a'), /root ack failed/);
    const waiting = h.navigation(); assert.equal(waiting.busy, true); assert.equal(waiting.operationBusy, false);
    assert.equal(waiting.pendingWorkbookDeletion, 'a');
    await assert.rejects(waiting.createProduct(), /尚未确认/);
    await assert.rejects(waiting.deleteWorkbook('b'), /尚未确认/);
    h.state().projects.find(project => project.id === 'b1').title = '晚到的其他产品编辑';
    h.fault(false); await waiting.deleteWorkbook('a', true);
    assert.equal(h.state().projects.find(project => project.id === 'b1').title, '晚到的其他产品编辑');
    assert.equal(h.events.filter(event => event === 'publish').length, 2); // 删除根一次，enter记忆更新一次。
    assert.equal(h.events.filter(event => event.startsWith('checkpoint:')).length, 1);
    assert.ok(h.events.includes('retry')); assert.equal(h.events.at(-1), 'navigate:/canvas/b1');
    assert.equal(h.navigation().busy, false); assert.equal(h.gate.getSnapshot(), '');
  } finally { h.close(); }
});
test('候选统一入口复用同一操作锁，ACK后才允许兜底导航，不接媒体删除', () => {
  assert.equal(preview.delta.size, 7);
  const operations = preview.delta.get('web/src/guan/产品操作.ts').产物;
  assert.match(operations, /deleteWorkbook = useCallback/); assert.match(operations, /workbookDeletionGate\.run/);
  assert.match(operations, /busy = operationBusy \|\| Boolean\(pendingWorkbookDeletion\)/);
  assert.match(operations, /deletionGuards\.get\(id\)/);
  assert.doesNotMatch(operations, /deleteMedia|removeMedia|cleanupUnused|clear\(/);
  const picker = preview.delta.get('web/src/guan/Excel工作簿选择.tsx').产物;
  assert.doesNotMatch(picker, /工作簿整批删除不在本批/);
  assert.match(picker, /WorkbookDeleteDialog/); assert.match(picker, /disabled=\{busy\}/);
});
test('确认框继承旧危险操作文案及结构，保存失败重试不误报成功', () => {
  const dialog = own('工作簿删除弹窗.tsx');
  assert.match(dialog, /删除 Excel？/); assert.match(dialog, /关联的产品、任务和素材记录也会从本地数据中删除/);
  assert.match(dialog, /className="danger"/); assert.match(dialog, /重试保存后继续/);
  assert.match(dialog, /pendingWorkbookDeletion/); assert.match(dialog, /onClose\(\)/);
  assert.doesNotMatch(dialog, /dangerouslySetInnerHTML|localStorage|indexedDB|window\.confirm|setTimeout/);
});
test('合成SQLite分片保存冷重开：仅移除目标工作簿，媒体文件未删除', async () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-workbook-delete-')), workspace = openWorkspace({ dataRoot: root, initialize: true });
  const client = { readDocument: (...args) => workspace.readDocument(...args), writeDocument: (...args) => workspace.writeDocument(...args), readMedia: id => workspace.readMedia(id), writeMedia: (...args) => workspace.writeMedia(...args) };
  const app = createRecoverableShardedApplicationStorage({ client });
  const store = app.createInstance({ name: 'infinite-canvas', storeName: 'app_state' });
  try {
    const bytes = Buffer.from('合成媒体，验证整批删除不会清理文件'), media = workspace.writeMedia(bytes, 'image/png');
    const original = state(); original.guanWorkbooks.contract.assets[0].url = `sqlite-media://${media.id}`;
    await store.setItem('canvas_store', JSON.stringify({ state: original, version: 0 })); await app.flush();
    const next = domain.planWorkbookDeletion(original, 'a', 'a1').state;
    await store.setItem('canvas_store', JSON.stringify({ state: next, version: 0 })); await app.flush();
    app.close(); workspace.close();
    const cold = openWorkspace({ dataRoot: root });
    const restored = createRecoverableShardedApplicationStorage({ client: { readDocument: (...args) => cold.readDocument(...args), writeDocument: (...args) => cold.writeDocument(...args), readMedia: id => cold.readMedia(id) } });
    try { const value = JSON.parse(await restored.createInstance({ name: 'infinite-canvas', storeName: 'app_state' }).getItem('canvas_store')).state;
      assert.deepEqual(value, clean(next)); ownership.assertWorkbookSnapshot(value);
      const actual = cold.readMedia(media.id);
      assert.equal(createHash('sha256').update(actual.bytes).digest('hex'), media.id);
      assert.deepEqual(actual.bytes, bytes);
      assert.deepEqual(readFileSync(join(root, '媒体', media.id)), bytes);
    } finally { restored.close(); cold.close(); }
  } finally { app.close(); try { workspace.close(); } catch { /* 已正常关闭。 */ } }
});
