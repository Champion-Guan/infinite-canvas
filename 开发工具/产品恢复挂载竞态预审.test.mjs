import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ts } from './检查首批功能适配.mjs';
import { 构建产品恢复挂载候选 } from './预审产品恢复挂载竞态.mjs';
import { 构建产品恢复挂载复审候选 } from './复审产品恢复挂载竞态.mjs';

// 加载真实候选函数；React调度、SQLite ACK和路由为显式替身，不能代替批准后的浏览器验收。
const firstPreview = 构建产品恢复挂载候选();
const preview = 构建产品恢复挂载复审候选();
const source = name => readFileSync(join(preview.integration.副本, 'web/src/guan', name), 'utf8');
const candidate = name => preview.delta.get('web/src/guan/' + name).产物;
function load(value, ports = {}) {
  const exports = {}, js = ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', 'window', js)(exports, name => {
    if (!Object.hasOwn(ports, name)) throw Error('未声明测试依赖：' + name);
    return ports[name];
  }, { matchMedia: () => ({ matches: true }) });
  return exports;
}
const rules = load(source('产品规则.ts'));
const recycle = load(source('产品回收规则.ts'), { './产品任务摘要.js': load(source('产品任务摘要.js')), './产品规则': rules });
const makeProject = id => ({ id, title: id, createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z',
  nodes: [{ id: id + '-image', type: 'image', metadata: { content: 'blob:synthetic-png', storageKey: id + '-media' } }],
  connections: [{ id: id + '-edge', fromNodeId: id + '-text', toNodeId: id + '-image' }],
  chatSessions: [{ id: id + '-chat', messages: [{ role: 'user', content: '合成消息' }] }], activeChatId: id + '-chat',
  backgroundMode: 'lines', showImageInfo: false, viewport: { x: 45, y: -23, k: 0.8 } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function microtasksUntil(predicate) {
  for (let count = 0; count < 40 && !predicate(); count++) await Promise.resolve();
  assert.ok(predicate(), '预期异步检查点未到达');
}

function harness({ old = false, first = false, activeId = 'B', prematureWrite = false } = {}) {
  const gateModule = load(candidate('产品恢复挂载门禁.ts')), gate = gateModule.productRestoreMountGate;
  const archived = makeProject('A');
  let state = { hydrated: true, projects: [makeProject('B')], deletedProjects: [{ id: 'A', project: archived, nextProductId: 'B', deletedAt: 'time' }] };
  let route = activeId, flushCount = 0, commitCount = 0, stateWrites = 0, prematurelyMounted = false;
  let control = async () => {}, navigateControl = () => {}, checkpointControl = async () => {};
  const navigations = [], events = [], prefs = new Map([['guan-products:active:v1', activeId]]);
  const store = selector => selector(state);
  store.getState = () => ({ ...state, openProject: id => state.projects.find(item => item.id === id) ?? null });
  store.setState = patch => {
    state = { ...state, ...patch }; stateWrites++;
    const view = render();
    if (prematureWrite && view.ids.includes('A')) prematurelyMounted = true;
    events.push({ kind: 'publish', mounted: view.ids, blocked: [...gate.getSnapshot()] });
  };
  const react = { useCallback: value => value, useRef: value => ({ current: value }), useState: value => [value, () => {}],
    useSyncExternalStore: (_subscribe, read) => read(), useLayoutEffect: callback => callback(), useEffect() {}, memo: value => value };
  const router = { useMatch: pattern => pattern === '/' ? (route ? null : {}) : route ? { params: { id: route } } : null,
    useNavigate: () => path => { navigateControl(path); navigations.push(path); route = path.startsWith('/canvas/') ? path.slice('/canvas/'.length) : ''; events.push({ kind: 'navigate', blocked: [...gate.getSnapshot()] }); },
    Route: 'Route', Routes: 'Routes' };
  const navigation = load(old ? source('产品操作.ts') : first ? firstPreview.delta.get('web/src/guan/产品操作.ts').产物 : candidate('产品操作.ts'), {
    react, 'react-router-dom': router, '@/stores/canvas/use-canvas-store': { useCanvasStore: store },
    '@/guan/上游浏览器存储桥': { flushSQLiteStorage: async () => {
      const count = ++flushCount; events.push({ kind: 'flush', count, blocked: [...gate.getSnapshot()] });
      if (prematurelyMounted) throw Error('模拟恢复挂载产生新保存');
      await control(count);
    }, sqlitePreferences: { getItem: key => prefs.get(key) ?? null, setItem: (key, value) => prefs.set(key, value), removeItem: key => prefs.delete(key) } },
    './产品规则': rules, './产品回收规则': recycle, './产品恢复挂载门禁': gateModule,
    './产品保存检查点': { ProductCommitCheckpoint: class { mount() {} unmount() {} commit() {} async flush() { commitCount++; await checkpointControl(); } } },
  });
  const nav = navigation.useProductNavigation();
  if (state.projects.some(item => item.id === activeId)) navigation.useProductCanvasSave(activeId, {}, () => true, async () => {});
  function render() {
    const jsx = (type, props) => ({ type, props });
    const workspace = load(old ? source('产品工作区.tsx') : candidate('产品工作区.tsx'), {
      react: { ...react, useState: () => [['B', 'A'], () => {}] }, 'react/jsx-runtime': { jsx, jsxs: jsx },
      'react-router-dom': router, 'zustand/react/shallow': { useShallow: callback => callback },
      '@/stores/canvas/use-canvas-store': { useCanvasStore: store }, '@/pages/canvas/project': { default: 'CanvasProject' },
      '@/pages/not-found': { default: 'NotFound' }, '@/guan/画布入口': { CanvasEntry: 'CanvasEntry' },
      './产品界面边界': { ProductSurface: 'ProductSurface' }, './产品恢复挂载门禁': gateModule,
    });
    const rendered = workspace.ProductWorkspace(), children = rendered.props.children;
    return { ids: children[0].map(child => child.props.id), pending: children[1]?.props?.role === 'status', fallback: children[1]?.type };
  }
  return { gate, gateModule, nav, render, prefs, navigations, events, state: () => state, flushCount: () => flushCount, commitCount: () => commitCount,
    stateWrites: () => stateWrites, control: value => { control = value; }, navigateControl: value => { navigateControl = value; }, checkpointControl: value => { checkpointControl = value; } };
}

test('复现旧实现：曾访问的恢复产品在发布时提前挂载，诱发保存门禁拒绝', async () => {
  const h = harness({ old: true, prematureWrite: true });
  await assert.rejects(h.nav.restoreProduct('A'), /恢复挂载产生新保存/);
  assert.deepEqual(h.events.find(event => event.kind === 'publish').mounted, ['B', 'A']);
  assert.deepEqual(h.navigations, []);
});
test('候选：相同旧缓存不提前挂载，保留当前B，完整ACK后导航并释放A', async () => {
  const h = harness({ prematureWrite: true });
  await h.nav.restoreProduct('A');
  assert.equal(h.commitCount(), 1);
  assert.deepEqual(h.events.find(event => event.kind === 'publish').mounted, ['B']);
  assert.deepEqual(h.events.find(event => event.kind === 'navigate').blocked, ['A']);
  assert.deepEqual(h.navigations, ['/canvas/A']);
  assert.deepEqual(h.gate.getSnapshot(), []);
  assert.deepEqual(h.render().ids, ['B', 'A']);
  assert.deepEqual(h.state().projects.find(item => item.id === 'A'), makeProject('A'));
});
test('恢复根延迟与导航偏好延迟期间均不挂载；既有B实例不被过滤', async () => {
  const h = harness(), root = deferred(), preference = deferred();
  h.control(count => count === 2 ? root.promise : count === 3 ? preference.promise : undefined);
  const operation = h.nav.restoreProduct('A');
  await microtasksUntil(() => h.flushCount() === 2);
  assert.deepEqual(h.render().ids, ['B']); assert.deepEqual(h.navigations, []);
  root.resolve(); await microtasksUntil(() => h.flushCount() === 3);
  assert.deepEqual(h.render().ids, ['B']); assert.deepEqual(h.gate.getSnapshot(), ['A']);
  preference.resolve(); await operation;
  assert.deepEqual(h.render().ids, ['B', 'A']);
});
for (const failAt of [2, 3]) test(`第${failAt}次flush拒绝：门禁保留，幂等重试不重复恢复、不覆盖快照`, async () => {
  const h = harness(); h.control(count => { if (count === failAt) throw Error('模拟ACK拒绝'); });
  await assert.rejects(h.nav.restoreProduct('A'), /ACK拒绝/);
  const restored = structuredClone(h.state());
  assert.deepEqual(h.render().ids, ['B']); assert.deepEqual(h.gate.getSnapshot(), ['A']);
  assert.deepEqual(h.navigations, []); assert.equal(h.prefs.get('guan-products:active:v1'), 'B');
  h.control(async () => {}); await h.nav.restoreProduct('A');
  assert.equal(h.stateWrites(), 1); assert.deepEqual(h.state(), restored);
  assert.deepEqual(h.gate.getSnapshot(), []); assert.deepEqual(h.navigations, ['/canvas/A']);
});
test('网址本就指向已归档A时：ACK失败不提前挂载或显示空白，而显示未确认状态', async () => {
  const h = harness({ activeId: 'A' }); h.control(count => { if (count === 2) throw Error('模拟归档原路由恢复失败'); });
  await assert.rejects(h.nav.restoreProduct('A'), /原路由恢复失败/);
  assert.deepEqual(h.render().ids, ['B']); assert.equal(h.render().pending, true);
  assert.deepEqual(h.gate.getSnapshot(), ['A']); assert.deepEqual(h.navigations, []);
});
test('复现首版候选：原路由A恢复失败后，重试要求未挂载的画布检查点而卡住', async () => {
  const h = harness({ first: true, activeId: 'A' });
  h.control(count => { if (count === 2) throw Error('模拟根ACK失败'); });
  await assert.rejects(h.nav.restoreProduct('A'), /根ACK失败/);
  h.control(async () => {});
  await assert.rejects(h.nav.restoreProduct('A'), /画布尚未加载/);
  assert.deepEqual(h.gate.getSnapshot(), ['A']);
  assert.deepEqual(h.navigations, []);
});
for (const failAt of [2, 3]) test(`原路由A在第${failAt}次flush拒绝后可重试；不要求尚未挂载的检查点且保留全局ACK`, async () => {
  const h = harness({ activeId: 'A' });
  h.control(count => { if (count === failAt) throw Error('模拟恢复ACK失败'); });
  await assert.rejects(h.nav.restoreProduct('A'), /恢复ACK失败/);
  const restored = structuredClone(h.state()), previousFlushes = h.flushCount();
  assert.equal(h.render().pending, true);
  h.control(count => { if (count === previousFlushes + 1) throw Error('重试全局ACK仍未确认'); });
  await assert.rejects(h.nav.restoreProduct('A'), /重试全局ACK仍未确认/);
  assert.equal(h.commitCount(), 0); assert.deepEqual(h.gate.getSnapshot(), ['A']);
  assert.deepEqual(h.navigations, []);
  h.control(async () => {}); await h.nav.restoreProduct('A');
  assert.equal(h.flushCount(), previousFlushes + 4);
  assert.equal(h.commitCount(), 0); assert.equal(h.stateWrites(), 1);
  assert.deepEqual(h.state(), restored); assert.deepEqual(h.gate.getSnapshot(), []);
  assert.deepEqual(h.navigations, ['/canvas/A']); assert.equal(h.render().pending, false);
});
test('普通当前产品仍须提交检查点，失败不发布恢复状态或导航', async () => {
  const h = harness(); h.checkpointControl(() => { throw Error('模拟当前画布提交失败'); });
  await assert.rejects(h.nav.restoreProduct('A'), /当前画布提交失败/);
  assert.equal(h.commitCount(), 1); assert.equal(h.flushCount(), 0); assert.equal(h.stateWrites(), 0);
  assert.deepEqual(h.gate.getSnapshot(), []); assert.deepEqual(h.navigations, []);
});
test('导航发起抛错不放行；用户显式重试后仍可恢复', async () => {
  const h = harness(); h.navigateControl(() => { throw Error('模拟导航失败'); });
  await assert.rejects(h.nav.restoreProduct('A'), /导航失败/);
  assert.deepEqual(h.gate.getSnapshot(), ['A']); assert.deepEqual(h.render().ids, ['B']);
  h.navigateControl(() => {}); await h.nav.restoreProduct('A');
  assert.equal(h.stateWrites(), 1); assert.deepEqual(h.gate.getSnapshot(), []);
});
test('全局恢复保存后，用户显式切到已恢复A也经过原保存检查后才释放', async () => {
  const h = harness(); h.control(count => { if (count === 2) throw Error('模拟恢复失败'); });
  await assert.rejects(h.nav.restoreProduct('A'), /恢复失败/);
  h.control(async () => {}); await h.nav.selectProduct('A');
  assert.deepEqual(h.navigations, ['/canvas/A']); assert.deepEqual(h.gate.getSnapshot(), []);
  assert.equal(h.commitCount(), 2);
});
test('已恢复但未入场的A再次归档：失败不释放，根确认后才清除门禁', async () => {
  const h = harness(); h.control(count => { if (count === 2 || count === 4) throw Error('模拟根失败'); });
  await assert.rejects(h.nav.restoreProduct('A'), /根失败/);
  await assert.rejects(h.nav.recycleProduct('A'), /根失败/);
  assert.deepEqual(h.gate.getSnapshot(), ['A']);
  h.control(async () => {}); await h.nav.recycleProduct('A');
  assert.deepEqual(h.gate.getSnapshot(), []);
  assert.deepEqual(h.state().deletedProjects[0].project, makeProject('A'));
  assert.deepEqual(h.navigations, []);
});
test('ID冲突和旧tombstone先拒绝，不把活动产品误锁入挂载门禁', async () => {
  const h = harness(); await assert.rejects(h.nav.restoreProduct('missing'), /没有可恢复/);
  assert.deepEqual(h.gate.getSnapshot(), []); assert.deepEqual(h.render().ids, ['B']);
  const state = h.state(); state.deletedProjects.push({ id: 'legacy', deletedAt: 'time' });
  await assert.rejects(h.nav.restoreProduct('legacy'), /没有可恢复/);
  assert.deepEqual(h.gate.getSnapshot(), []);
  state.projects.push(makeProject('A'));
  await assert.rejects(h.nav.restoreProduct('A'), /相同ID/);
  assert.deepEqual(h.gate.getSnapshot(), []);
});
test('门禁快照稳定、不可变、重复操作不重复发通知、取消订阅有效', () => {
  const { gateModule } = harness(), gate = new gateModule.ProductRestoreMountGate();
  const initial = gate.getSnapshot(); let notifications = 0;
  const unsubscribe = gate.subscribe(() => notifications++);
  gate.block('A'); const blocked = gate.getSnapshot();
  assert.deepEqual(initial, []); assert.notEqual(initial, blocked); assert.ok(Object.isFrozen(blocked));
  gate.block('A'); assert.equal(gate.getSnapshot(), blocked); assert.equal(notifications, 1);
  assert.throws(() => blocked.push('unsafe'), TypeError);
  gate.release('missing'); assert.equal(notifications, 1);
  gate.block('B'); gate.release('A'); assert.deepEqual(gate.getSnapshot(), ['B']);
  assert.equal(notifications, 3); unsubscribe(); gate.release('B'); assert.equal(notifications, 3);
});
test('仅三文件候选，SQLite桥、既有保存检查点、任务摘要及组件布局不改', () => {
  assert.equal(preview.delta.size, 3);
  assert.deepEqual([...preview.delta.keys()].sort(), ['web/src/guan/产品恢复挂载门禁.ts', 'web/src/guan/产品操作.ts', 'web/src/guan/产品工作区.tsx'].sort());
  assert.equal(preview.delta.get('web/src/guan/产品恢复挂载门禁.ts').原文, null);
  const operations = candidate('产品操作.ts');
  assert.doesNotMatch(operations, /setTimeout|retrySQLiteStorage|\.clear\(/);
  assert.match(operations, /await flushSQLiteStorage\(\);\n {8}if \(!useCanvasStore/);
  assert.match(candidate('产品工作区.tsx'), /<ProductCanvas key=\{id\} id=\{id\} active=\{id === activeId\}/);
});
