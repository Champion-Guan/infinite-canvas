import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function load(name, dependencies = {}, extra = '') {
  const path = resolve(root, '扩展功能/产品', name);
  const { code } = await transformWithEsbuild(readFileSync(path, 'utf8') + extra, path, {
    loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', code)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `未注入依赖：${id}`);
    return dependencies[id];
  }, module, module.exports, { matchMedia: () => ({ matches: false }) });
  return module.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const settle = () => new Promise(done => setImmediate(done));

async function harness(excel = true) {
  const rules = await load('产品规则.ts');
  const workbookSave = await load('../Excel/Excel保存导航.ts');
  const { ProductCommitCheckpoint } = await load('产品保存检查点.ts');
  const residency = await load('画布驻留保护.ts');
  const feature = { productFeatures: { excel }, requireProductFeature() { if (!excel) throw Object.assign(Error('Excel 功能已关闭'), { code: 'product_feature_disabled' }); } };
  const navigationScope = await load('产品导航范围.ts', {
    '../产品配置/功能开关': feature, './产品规则': rules,
    '../Excel/Excel产品归属': {
      orderedWorkbookProjects: (projects, owner) => projects.filter(project => project.productSetId === owner),
      visibleWorkbookId: () => 'book', withVisibleSelection: value => value,
      rememberWorkbookProduct: (state, id) => ({ ...state.guanWorkbooks, activeProductId: id }),
      workbookEntry: value => value.guanWorkbooks.activeProductId,
    },
  });
  let activeId = 'A', pendingDeletion = false;
  let flush = async () => {};
  const events = [], preferences = new Map([['guan-products:active:v1', activeId]]);
  const blocked = new Set();
  const storage = { state: 'saved', pending: 0 };
  const state = { hydrated: true, guanWorkbooks: { contract: { products: [] } },
    projects: ['A', 'B', 'C'].map(id => ({ id, title: id, productSetId: 'book', nodes: [{ id: `${id}-node` }] })),
    openProject(id) { return this.projects.find(project => project.id === id); },
    createProject() {
      const id = 'new';
      this.projects.push({ id, title: id, productSetId: 'book', nodes: [] });
      return id;
    },
    updateProject(id, patch) { Object.assign(this.openProject(id), patch); },
  };
  const product = await load('产品操作.ts', {
    react: { useCallback: fn => fn, useSyncExternalStore: (_subscribe, get) => get() },
    'react-router-dom': {
      useMatch: () => ({ params: { id: activeId } }),
      useNavigate: () => (url, options) => {
        activeId = decodeURIComponent(url.split('/').at(-1));
        events.push({ type: 'navigate', id: activeId, options });
      },
    },
    '@/stores/canvas/use-canvas-store': { useCanvasStore: {
      getState: () => state, setState: patch => { events.push({ type: 'remember', id: activeId }); Object.assign(state, patch); },
    } },
    '../画布导入/画布导入': { readCanvasExport: async () => [] },
    '../本机存储/上游浏览器存储桥': {
      sqlitePreferences: { getItem: key => preferences.get(key) ?? null,
        setItem: (key, value) => preferences.set(key, value), removeItem: key => preferences.delete(key) },
      async flushSQLiteStorage() {
        events.push({ type: 'flush' }); storage.state = 'saving'; storage.pending++;
        try { await flush(); storage.state = 'saved'; }
        catch (error) { storage.state = 'error'; throw error; }
        finally { storage.pending--; }
      },
      storageStatus: () => storage, retrySQLiteStorage: async () => {},
    },
    './产品规则': rules,
    './产品导航范围': navigationScope,
    '../产品配置/功能开关': feature,
    './画布驻留保护': residency,
    './产品保存检查点': { ProductCommitCheckpoint },
    './产品回收规则': {},
    '../Excel删除/工作簿删除规则': {},
    '../Excel删除/工作簿删除门禁': { workbookDeletionGate: {
      getSnapshot: () => pendingDeletion, subscribe: () => () => {},
    } },
    '../Excel删除/Excel回收站规则': {},
    '../Excel/Excel保存导航': workbookSave,
    '../Excel/Excel产品归属': { visibleWorkbookId: () => 'book',
      workbookProjects: (projects, owner) => projects.filter(project => project.productSetId === owner),
      rememberWorkbookProduct: (state, id) => ({ ...state.guanWorkbooks, activeProductId: id }),
      withVisibleSelection: value => value,
      selectWorkbook: (state, owner) => ({ ...state.guanWorkbooks, owner, activeProductId: 'B' }),
      prepareWorkbookEntry: value => value,
      workbookEntry: value => value.guanWorkbooks.activeProductId,
    },
    '../Excel画布/产品参数卡片默认': { ensureProductParameterNode: nodes => nodes },
    './产品恢复挂载门禁': { productRestoreMountGate: {
      getSnapshot: () => [...blocked], release: id => blocked.delete(id),
    } },
    '../画布生成/批量保存协调': { isBatchCanvasSaveActive: () => false },
    '../软件更新/升级页面状态.mjs': { registerUpgradeParticipant() {} },
  }, String.fromCharCode(10) + 'export { saves as testSaves };');
  return { state, events, preferences, blocked, storage, ProductCommitCheckpoint,
    nav: () => product.useProductNavigation(), active: () => activeId,
    controlFlush: action => { flush = action; }, deletePending: value => { pendingDeletion = value; },
    register(id, action = async () => {}) {
      return product.testSaves.register(id, async options => { events.push({ type: 'checkpoint', id, options }); await action(options); },
        () => events.push({ type: 'ack', id }));
    },
  };
}

test('Excel关闭后跨工作簿与未关联产品可立即切换，保留旧工作簿和全部卡片', async () => {
  const h = await harness(false);
  h.state.projects[1].productSetId = 'another-book';
  h.state.projects[2].productSetId = null;
  const before = JSON.stringify(h.state.projects), books = h.state.guanWorkbooks;
  h.register('A'); h.register('B'); h.register('C');
  await h.nav().selectProduct('B');
  await h.nav().selectProduct('C');
  assert.equal(h.active(), 'C');
  assert.equal(h.preferences.get('guan-products:active:v1'), 'C');
  assert.equal(h.state.guanWorkbooks, books);
  assert.equal(JSON.stringify(h.state.projects), before);
  for (const [name, args] of [['selectWorkbook', ['book']], ['importWorkbook', [{}]], ['deleteWorkbook', ['book']],
    ['restoreWorkbook', ['book']], ['permanentlyDeleteWorkbook', ['book']]]) {
    const calls = h.events.length;
    await assert.rejects(h.nav()[name](...args), { code: 'product_feature_disabled' });
    assert.equal(h.events.length, calls, name + '在保存或改动前拒绝');
  }
});

test('已保存画布先同步切换，SQLite慢回执不锁定胶囊，连续点击可改去下一产品', async () => {
  const h = await harness(), disk = deferred();
  let renders = 0, rewrites = 0;
  const checkpoint = new h.ProductCommitCheckpoint(() => { renders++; });
  checkpoint.mount(); checkpoint.commit(0, { saved: true }, true);
  h.register('A', options => checkpoint.flush(async () => { rewrites++; }, options));
  h.register('B'); h.controlFlush(() => disk.promise);
  const first = h.nav().selectProduct('B');
  assert.equal(h.active(), 'B', '同一个按下调用栈已经同步导航');
  assert.equal(h.events[0].type, 'navigate', '导航先于偏好状态引起的旧画布渲染');
  assert.equal(h.events.find(event => event.type === 'remember').id, 'B');
  await settle();
  assert.equal(h.active(), 'B');
  assert.equal(h.nav().busy, false, '保存未确认期间必须允许再点胶囊');
  assert.equal(renders, 0); assert.equal(rewrites, 0, '已保存基线无需重复请求画布快照');
  const second = h.nav().selectProduct('C');
  await settle();
  assert.equal(h.active(), 'C'); assert.equal(h.nav().busy, false);
  const transitions = h.events.filter(event => event.type === 'navigate');
  assert.deepEqual(transitions.map(event => event.id), ['B', 'C']);
  assert.ok(transitions.every(event => event.options.flushSync && !event.options.viewTransition));
  assert.equal(h.events[0].type, 'navigate', 'React检查点与磁盘写入均在可见导航之后');
  assert.equal(h.events.filter(event => event.type === 'ack').length, 0);
  disk.resolve(); await Promise.all([first, second]);
  assert.deepEqual(h.events.filter(event => event.type === 'ack').map(event => event.id), ['A', 'B']);
  assert.equal(h.preferences.get('guan-products:active:v1'), 'C');
  checkpoint.unmount();
});

test('旧画布检查点尚未提交时已经显示目标产品，后台只保存原ID且不覆盖目标内容', async () => {
  const h = await harness(), commit = deferred();
  const before = structuredClone(h.state.projects);
  h.register('A', async options => { assert.equal(options.deferSQLiteFlush, true); await commit.promise; });
  const switching = h.nav().selectProduct('B');
  await settle();
  assert.equal(h.active(), 'B'); assert.equal(h.nav().busy, false);
  assert.equal(h.events.some(event => event.type === 'flush'), false);
  assert.deepEqual(h.state.projects, before);
  commit.resolve(); await switching;
  assert.equal(h.events.find(event => event.type === 'checkpoint').id, 'A');
  assert.deepEqual(h.state.projects, before);
});

test('后台SQLite失败不回滚路由、不提前ACK，保留错误与两份画布', async () => {
  const h = await harness(); h.register('A');
  h.controlFlush(async () => { throw new Error('合成磁盘失败'); });
  await assert.rejects(h.nav().selectProduct('B'), /合成磁盘失败/);
  assert.equal(h.active(), 'B'); assert.equal(h.nav().busy, false);
  assert.equal(h.storage.state, 'error');
  assert.equal(h.preferences.get('guan-products:active:v1'), 'B');
  assert.deepEqual(h.state.projects.map(project => project.id), ['A', 'B', 'C']);
  assert.equal(h.events.some(event => event.type === 'ack'), false);
});

test('后台React检查点失败明确返回给胶囊界面，不吞异常或清空原画布', async () => {
  const h = await harness();
  h.register('A', async () => { throw new Error('检查点未确认'); });
  await assert.rejects(h.nav().selectProduct('B'), /已切换产品.*原画布保存尚未确认.*检查点未确认/);
  assert.equal(h.active(), 'B'); assert.equal(h.nav().busy, false);
  assert.deepEqual(h.state.openProject('A').nodes, [{ id: 'A-node' }]);
  assert.equal(h.events.some(event => event.type === 'ack'), false);
});

test('点击当前胶囊不写入；未加载、删除未确认和跨工作簿点击在导航前拒绝', async () => {
  const h = await harness();
  await h.nav().selectProduct('A'); assert.deepEqual(h.events, []);
  h.state.hydrated = false;
  await assert.rejects(h.nav().selectProduct('B'), /尚未加载/);
  h.state.hydrated = true; h.deletePending('book');
  await assert.rejects(h.nav().selectProduct('B'), /删除保存尚未确认/);
  h.deletePending(false); h.state.openProject('C').productSetId = 'other';
  await assert.rejects(h.nav().selectProduct('C'), /目标产品不可用/);
  await assert.rejects(h.nav().selectProduct('missing'), /目标产品不可用/);
  assert.deepEqual(h.events, []); assert.equal(h.active(), 'A');
});

test('恢复中的目标产品仍等真实ACK，失败不放行挂载或切换', async () => {
  const h = await harness(), disk = deferred();
  h.register('A'); h.blocked.add('B'); h.controlFlush(() => disk.promise);
  const switching = h.nav().selectProduct('B');
  const rejected = assert.rejects(switching, /恢复未确认/);
  await settle();
  assert.equal(h.active(), 'A'); assert.equal(h.nav().busy, true); assert.ok(h.blocked.has('B'));
  disk.reject(new Error('恢复未确认')); await rejected;
  assert.equal(h.active(), 'A'); assert.ok(h.blocked.has('B')); assert.equal(h.nav().busy, false);
});

test('新建产品仍先确认当前保存，失败不创建或导航', async () => {
  const h = await harness();
  h.register('A', async () => { throw new Error('保存失败'); });
  await assert.rejects(h.nav().createProduct(), /保存失败/);
  assert.equal(h.state.projects.length, 3); assert.equal(h.active(), 'A');
  assert.equal(h.events.some(event => event.type === 'navigate'), false);
});

test('恢复产品和切换Excel均不用浏览器整页快照，避免胶囊越过滚动区与弹窗遮罩', async () => {
  const h = await harness(); h.register('A'); h.blocked.add('B');
  await h.nav().selectProduct('B');
  assert.equal(h.events.find(event => event.type === 'navigate').options.viewTransition, false);
  assert.equal(h.blocked.has('B'), false);
  h.register('B');
  await h.nav().selectWorkbook('other-workbook');
  assert.equal(h.events.filter(event => event.type === 'navigate').at(-1).options.viewTransition, false);
  assert.equal(h.state.guanWorkbooks.owner, 'other-workbook');
});
