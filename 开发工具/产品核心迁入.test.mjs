import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { 根目录 } from './公共.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 构建产品核心候选, 产品自有文件, 产品Portal文件, 取唯一片段 } from './预审产品核心迁入.mjs';

const preview = 构建产品核心候选();
const candidate = path => preview.delta.get('web/src/' + path).产物;
const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function load(source, require = () => { throw Error('未声明的测试依赖'); }, timers = { setTimeout, clearTimeout }) {
  const exports = {};
  new Function('exports', 'require', 'setTimeout', 'clearTimeout', transpile(source))(exports, require, timers.setTimeout, timers.clearTimeout);
  return exports;
}
const rules = load(candidate('guan/产品规则.ts'));
const task = load(candidate('guan/产品任务摘要.js'));
const display = load(candidate('guan/旧版产品显示名.js')).productDisplayName;
const identity = (id, title, createdAt = '2026-10-18T00:00:00.000Z') => ({ id, title, createdAt });

for (const [titles, expected] of [
  [[], '未命名产品1'], [['未命名产品1'], '未命名产品2'],
  [['未命名产品1', '未命名产品3'], '未命名产品4'],
  [['已重命名', '未命名产品2'], '未命名产品3'],
  [['产品99', '未命名产品x', '未命名产品-1', ' 未命名产品6'], '未命名产品1'],
  [['未命名产品09', '未命名产品2'], '未命名产品10'],
  [['未命名产品9007199254740992'], '未命名产品1'],
]) test('命名规则：' + JSON.stringify(titles), () => assert.equal(rules.nextProductTitle(titles.map(title => ({ title }))), expected));

test('MAX_SAFE编号拒绝继续创建，不生成失真编号', () => {
  assert.throws(() => rules.nextProductTitle([{ title: '未命名产品9007199254740991' }]), /上限/);
});
test('连续创建按当前真实列表分配唯一编号；重命名后继续最大值+1', () => {
  const projects = [];
  for (let index = 1; index <= 100; index++) {
    const title = rules.nextProductTitle(projects);
    assert.equal(title, '未命名产品' + index);
    projects.unshift(identity(String(index), title));
  }
  projects[2].title = '自定义产品';
  assert.equal(rules.nextProductTitle(projects), '未命名产品101');
});
test('同毫秒创建仍按旧创建顺序，内容修改不改变胶囊顺序', () => {
  const projects = [identity('C', 'C'), identity('B', 'B'), identity('A', 'A')];
  assert.deepEqual(rules.orderedProducts(projects).map(item => item.id), ['A', 'B', 'C']);
  projects[2].updatedAt = '2099-01-01';
  assert.deepEqual(rules.orderedProducts(projects).map(item => item.id), ['A', 'B', 'C']);
  assert.deepEqual(projects.map(item => item.id), ['C', 'B', 'A']);
});
test('刷新入口选择存在的记忆ID，失效ID安全回到最早创建产品', () => {
  const projects = [identity('B', 'B'), identity('A', 'A')];
  assert.equal(rules.selectEntryProduct(projects, 'B'), 'B');
  assert.equal(rules.selectEntryProduct(projects, 'missing'), 'A');
  assert.equal(rules.selectEntryProduct([], 'missing'), null);
});
test('显示名真实旧函数原样迁入，保留中英文竖线截断和回退', () => {
  const old = preview.snippets.displayName.trimEnd();
  assert.equal(candidate('guan/旧版产品显示名.js'), 'export ' + old + '\n');
  assert.equal(display({ title: ' 主图 ｜ 详情' }), '主图');
  assert.equal(display({ identity: { titleZh: '旧产品' } }), '旧产品');
  assert.equal(display({ title: ' | foo' }, 3), '产品 4');
});
test('真实旧任务摘要逐字节迁入，聚合所有任务而非只看最后一个', () => {
  assert.equal(candidate('guan/产品任务摘要.js'), preview.legacy.get('src/canvas/lib/canvas/task-summary.js'));
  const node = (id, status, generationStartedAt) => ({ id, type: 'image', metadata: { status, generationStartedAt } });
  const nodes = [node('slow', 'loading', 1), node('latest', 'success', 2)];
  assert.deepEqual(task.canvasTaskSummary(nodes), { status: 'loading', taskId: 'latest', startedAt: 2 });
  nodes[0].metadata.status = 'error';
  assert.equal(task.canvasTaskSummary(nodes).status, 'error');
  nodes[0].metadata.status = 'success';
  assert.equal(task.canvasTaskSummary(nodes).status, 'success');
  assert.equal(task.canvasTaskSummary([]).status, 'idle');
});
test('摘要排除已被输出任务代表的参数卡，避免双计数', () => {
  const nodes = [{ id: 'config', type: 'config', metadata: { status: 'loading', generationStartedAt: 1 } },
    { id: 'image', type: 'image', metadata: { status: 'success', generationStartedAt: 2 } }];
  assert.equal(task.canvasTaskSummary(nodes).status, 'loading');
  assert.equal(task.canvasTaskSummary(nodes, [{ fromNodeId: 'config', toNodeId: 'image' }]).status, 'success');
});
test('胶囊摘要缓存：移动视区不重算节点、无关字段不引发顶栏更新', () => {
  const code = 取唯一片段(candidate('guan/顶部产品胶囊.tsx'), 'function createSummarySelector()', '\nexport function ProductCapsules');
  let summaries = 0;
  const selector = new Function('orderedProducts', 'canvasTaskSummary', 'productDisplayName', transpile(code) + ';return createSummarySelector();')(
    rules.orderedProducts, (...args) => { summaries++; return task.canvasTaskSummary(...args); }, display,
  );
  let a = { ...identity('A', 'A'), nodes: [], connections: [] }, b = { ...identity('B', 'B'), nodes: [], connections: [] };
  const first = selector({ projects: [b, a] });
  assert.equal(summaries, 2);
  a = { ...a, viewport: { x: 100, y: -300, k: 2 } };
  assert.equal(selector({ projects: [b, a] }), first);
  assert.equal(summaries, 2);
  b = { ...b, nodes: [{ id: 'running', type: 'image', metadata: { status: 'loading', generationStartedAt: 1 } }] };
  const second = selector({ projects: [b, a] });
  assert.equal(second[0], first[0]);
  assert.equal(second[1].status, 'loading');
  assert.equal(summaries, 3);
});
test('操作锁拦截重复点击，成功和失败均释放，通知可取消', async () => {
  const gate = new rules.ProductOperationGate();
  const events = [], stop = gate.subscribe(() => events.push(gate.getSnapshot()));
  let release;
  const first = gate.run(() => new Promise(resolve => { release = resolve; }));
  await assert.rejects(gate.run(async () => 'duplicate'), /正在进行/);
  release('A'); assert.equal(await first, 'A');
  await assert.rejects(gate.run(async () => { throw Error('save failed'); }), /save failed/);
  assert.equal(gate.getSnapshot(), false);
  assert.deepEqual(events, [true, false, true, false]);
  stop(); await gate.run(async () => {});
  assert.equal(events.length, 4);
});
test('保存注册表按ID独立、拒绝重复实例并拒绝保存时卸载或换代', async () => {
  const registry = new rules.ProductSaveRegistry(), saved = [];
  const unregister = registry.register('A', async () => saved.push('A'));
  registry.register('B', async () => saved.push('B'));
  assert.throws(() => registry.register('A', async () => {}), /重复/);
  await registry.flush('A'); await registry.flush('B');
  assert.deepEqual(saved, ['A', 'B']);
  unregister();
  await assert.rejects(registry.flush('A'), /尚未加载/);
  let unregisterChanging;
  unregisterChanging = registry.register('changing', async () => { unregisterChanging(); });
  await assert.rejects(registry.flush('changing'), /实例已改变/);
});

function checkpointHarness() {
  let timerId = 0;
  const timers = new Map(), requested = [];
  const { ProductCommitCheckpoint } = load(candidate('guan/产品保存检查点.ts'), undefined, {
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  const checkpoint = new ProductCommitCheckpoint(ticket => requested.push(ticket));
  checkpoint.mount();
  return { checkpoint, requested, timers, commit(snapshot, ready = true) { checkpoint.commit(requested.at(-1), snapshot, ready); } };
}
test('保存必须等待真实提交票据，不能拿事件前的旧快照冒充已保存', async () => {
  const h = checkpointHarness(), saved = [];
  h.checkpoint.commit(0, { old: true }, true);
  const promise = h.checkpoint.flush(async value => saved.push(value));
  await Promise.resolve();
  assert.deepEqual(saved, []);
  h.checkpoint.commit(0, { stale: true }, true);
  await Promise.resolve();
  assert.deepEqual(saved, []);
  const current = { product: 'A', nodes: ['latest'], viewport: { x: 2, y: 3, k: 1 } };
  h.commit(current); await promise;
  assert.deepEqual(saved, [current]); assert.equal(h.timers.size, 0);
});
test('拖动、缩放或恢复未完成的画布不能被宣称已保存', async () => {
  const h = checkpointHarness();
  const promise = h.checkpoint.flush(async () => { throw Error('不应写入'); });
  h.commit({ editing: true }, false);
  await assert.rejects(promise, /正在编辑/);
});
test('落盘期间并发编辑会继续保存最新快照，合并同产品的保存调用', async () => {
  const h = checkpointHarness(), saved = [];
  let release;
  const first = h.checkpoint.flush(async value => {
    saved.push(value);
    if (value.revision === 1) await new Promise(resolve => { release = resolve; });
  });
  h.commit({ revision: 1 });
  await new Promise(resolve => setImmediate(resolve));
  const concurrent = h.checkpoint.flush(async value => saved.push(value));
  const latest = { revision: 2 };
  h.commit(latest); release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requested.length, 2);
  h.commit(latest);
  await Promise.all([first, concurrent]);
  assert.deepEqual(saved, [{ revision: 1 }, latest]);
});
test('保存失败向上传播，不清空画布；下一次保存可以正常完成', async () => {
  const h = checkpointHarness(), snapshot = { content: 'A' };
  const promise = h.checkpoint.flush(async () => { throw Error('disk full'); });
  h.commit(snapshot); await assert.rejects(promise, /disk full/);
  const retry = h.checkpoint.flush(async value => assert.equal(value, snapshot));
  h.commit(snapshot); await retry;
});
test('保存期间卸载或重挂载拒绝旧ACK，超时后可以重试', async () => {
  const h = checkpointHarness();
  const first = h.checkpoint.flush(async () => {});
  h.checkpoint.unmount();
  await assert.rejects(first, /失效/);
  h.checkpoint.mount();
  const second = h.checkpoint.flush(async () => {});
  for (const timer of [...h.timers.values()]) timer();
  await assert.rejects(second, /未确认提交/);
  const third = h.checkpoint.flush(async () => {});
  h.commit({ fresh: true }); await third;
});

function storeHarness() {
  let state, sequence = 0;
  const set = next => { const update = typeof next === 'function' ? next(state) : next; if (update !== state) state = { ...state, ...update }; };
  const store = load(candidate('stores/canvas/use-canvas-store.ts'), name => {
    if (name === 'zustand') return { create: () => initializer => { state = initializer(set, () => state); return { getState: () => state, setState: set }; } };
    if (name === 'zustand/middleware') return { persist: initializer => initializer };
    if (name === 'nanoid') return { nanoid: () => 'product-' + ++sequence };
    if (name === '@/guan/产品规则') return rules;
    if (name === '@/i18n') return { default: { t: key => key } };
    if (name === '@/lib/localforage-storage') return { localForageStorage: {} };
    if (name === '@/guan/上游浏览器存储桥') return { scheduleStateSave: () => { throw Error('此状态隔离测试不模拟持久化通过'); } };
    throw Error(name);
  }).useCanvasStore;
  return store.getState;
}
test('执行真实候选store：A/B卡片、连线、视区、标题独立，不串数据', () => {
  const get = storeHarness(), a = get().createProject(), b = get().createProject();
  assert.equal(get().openProject(a).title, '未命名产品1');
  assert.equal(get().openProject(b).title, '未命名产品2');
  const bBefore = get().openProject(b);
  const patch = { nodes: [{ id: 'A-node' }], connections: [{ id: 'A-edge' }], viewport: { x: -200, y: 30, k: 2 } };
  get().updateProject(a, patch); get().renameProject(a, 'A名称');
  assert.equal(get().openProject(b), bBefore);
  assert.deepEqual(get().openProject(a).nodes, patch.nodes);
  assert.deepEqual(get().openProject(a).viewport, patch.viewport);
  assert.equal(get().openProject(a).title, 'A名称');
  get().updateProject(b, { nodes: [{ id: 'B-node' }], viewport: { x: 9, y: 8, k: 0.5 } });
  assert.equal(get().openProject(a).nodes, patch.nodes);
  assert.deepEqual(get().openProject(b).nodes, [{ id: 'B-node' }]);
});
test('旧版no-op guard逐字节迁入，切换检查点重复提交不会触发更新循环', () => {
  const store = candidate('stores/canvas/use-canvas-store.ts');
  assert.ok(store.includes(preview.snippets.updateProject));
  const get = storeHarness(), id = get().createProject();
  const before = get(), project = before.openProject(id);
  get().updateProject(id, { nodes: project.nodes, viewport: project.viewport });
  assert.equal(get(), before);
  get().updateProject('missing', { nodes: [] });
  assert.equal(get(), before);
});
test('产品snapshot从旧版真实提交/视区保存块适配，不取消新视区定时器', () => {
  const project = candidate('pages/canvas/project.tsx');
  assert.ok(project.includes(preview.snippets.saveEffect));
  assert.ok(project.includes('useProductCanvasSave(projectId, updateFlushSnapshot,'));
  assert.ok(project.includes('if (viewportRef.current === snapshot.viewport)'));
  assert.ok(project.includes('await flushSQLiteStorage();'));
});
test('键鼠、弹窗和7个Portal按产品隔离；不篡改第三方全局API', () => {
  const project = candidate('pages/canvas/project.tsx');
  assert.ok(project.includes('if (!productActive || !referencePickerNodeId) return;'));
  assert.equal((project.match(/if \(!productActive\) return;/g) || []).length, 2);
  assert.equal((project.match(/open=\{productActive && /g) || []).length, 10);
  assert.ok(!project.includes('document.querySelector<HTMLElement>'));
  for (const file of 产品Portal文件) {
    const code = candidate('components/canvas/' + file);
    assert.ok(code.includes('createProductPortal('));
    assert.ok(!code.includes('import { createPortal }'));
  }
  const surface = candidate('guan/产品界面边界.tsx');
  assert.ok(surface.includes('inert={!active}'));
  assert.ok(surface.includes('visibility: active ? "visible" : "hidden"'));
  assert.ok(!surface.includes('display: "none"'));
  assert.ok(!surface.includes('AbortController'));
});
test('单一通配route保持工作区身份，冻结每个产品的子路由而不重建原画布', () => {
  const router = candidate('router.tsx'), workspace = candidate('guan/产品工作区.tsx');
  assert.equal((router.match(/element: <ProductWorkspace \/>/g) || []).length, 1);
  assert.ok(router.includes('{ path: "*", element: <ProductWorkspace /> }'));
  assert.ok(workspace.includes('key={id}'));
  assert.ok(workspace.includes('<Routes location={`/canvas/${encodeURIComponent(id)}`}>'));
  assert.ok(!workspace.includes('<iframe'));
  assert.ok(!workspace.includes('<Activity'));
});
test('范围锁定：30文件候选，不写浏览器存储、不增加服务权限或混入Excel/回收站', () => {
  assert.equal(preview.delta.size, 30);
  assert.equal(产品自有文件.length, 7);
  assert.equal([...preview.delta.values()].filter(item => item.原文 === null).length, 10);
  for (const [path, item] of preview.delta) {
    assert.ok(path.startsWith('web/src/'));
    if (item.原文 !== null) continue;
    assert.ok(!/\b(?:localStorage|sessionStorage|indexedDB)\b/.test(item.产物));
  }
  for (const file of 产品自有文件)
    assert.equal(candidate('guan/' + file), readFileSync(join(根目录, '扩展功能/产品', file), 'utf8'));
  const header = candidate('guan/旧版首页顶栏.tsx');
  assert.ok(header.includes('disabled title={pending}'));
});

function navigationHarness(activeId = '') {
  const get = storeHarness(), preferences = new Map(), events = [];
  let onFlush = async () => {}, flushNumber = 0;
  const storage = { state: 'idle' };
  get().hydrated = true;
  const exports = load(candidate('guan/产品操作.ts') + '\nexport { saves as testSaves };', name => {
    if (name === 'react') return { useCallback: fn => fn, useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() };
    if (name === 'react-router-dom') return { useMatch: () => ({ params: { id: activeId } }), useNavigate: () => (url, options) => events.push({ type: 'navigate', url, options }) };
    if (name === '@/stores/canvas/use-canvas-store') return { useCanvasStore: { getState: get } };
    if (name === './产品规则') return rules;
    if (name === './产品保存检查点') return load(candidate('guan/产品保存检查点.ts'));
    if (name === '@/guan/上游浏览器存储桥') return {
      flushSQLiteStorage: async () => {
        events.push({ type: 'flush' });
        try { await onFlush(++flushNumber); storage.state = 'saved'; }
        catch (error) { storage.state = 'error'; throw error; }
      }, storageStatus: () => storage,
      sqlitePreferences: { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value), removeItem: key => preferences.delete(key) },
    };
    throw Error(name);
  });
  // 只提供本机媒体偏好查询；不运行真实窗口、不模拟持久化成功。
  const previousWindow = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  return { get, preferences, events, storage, api: exports.useProductNavigation(), saves: exports.testSaves,
    onFlush: fn => { onFlush = fn; }, restore: () => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; } };
}
test('已保存产品切换不等待全局SQLite flush；路由立即切换，旧画布保存随后后台ACK', async () => {
  const h = navigationHarness('product-1');
  try {
    h.get().createProject(); const target = h.get().createProject();
    h.saves.register('product-1', async () => h.events.push({ type: 'save-current' }));
    let release;
    h.onFlush(() => new Promise(resolve => { release = resolve; }));
    const switching = h.api.selectProduct(target);
    for (let attempt = 0; attempt < 20 && !h.events.some(event => event.type === 'navigate'); attempt++)
      await new Promise(resolve => setImmediate(resolve));
    assert.ok(h.events.some(event => event.type === 'navigate'), '导航必须先于后台SQLite回执');
    assert.ok(h.events.findIndex(event => event.type === 'navigate') < h.events.findIndex(event => event.type === 'flush'));
    assert.equal(h.events.filter(event => event.type === 'flush').length, 1, '一次导航只启动一轮后台全局ACK');
    await switching;
    assert.equal(h.events.find(event => event.type === 'navigate').url, '/canvas/product-2');
    assert.equal(h.preferences.get('guan-products:active:v1'), target);
    assert.deepEqual(h.get().projects.map(project => project.id), ['product-2', 'product-1'], '两个产品数据均留在内存');
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.storage.state, 'saved');
  } finally { h.restore(); }
});
test('当前产品保存失败阻止创建、导航和偏好更新，不污染另一产品', async () => {
  const h = navigationHarness('product-1');
  try {
    h.get().createProject(); const before = h.get().projects;
    h.saves.register('product-1', async () => { throw Error('save rejected'); });
    await assert.rejects(h.api.createProduct(), /save rejected/);
    assert.equal(h.get().projects, before);
    assert.deepEqual(h.events, []);
  } finally { h.restore(); }
});
test('新产品保存失败保留已创建内容但不导航，重试不会复用或覆盖ID', async () => {
  const h = navigationHarness();
  try {
    h.onFlush(async count => { if (count === 2) throw Error('disk full'); });
    await assert.rejects(h.api.createProduct(), /disk full/);
    assert.equal(h.get().projects.length, 1);
    assert.equal(h.get().projects[0].title, '未命名产品1');
    assert.ok(h.events.every(event => event.type !== 'navigate'));
    h.onFlush(async () => {}); await h.api.createProduct();
    assert.equal(h.get().projects[0].title, '未命名产品2');
    assert.equal(h.get().projects.length, 2);
  } finally { h.restore(); }
});
test('产品切换后后台SQLite失败不回滚用户路由或编辑，保留全局保存错误供重试', async () => {
  const h = navigationHarness('product-1');
  try {
    h.get().createProject(); const target = h.get().createProject();
    h.preferences.set('guan-products:active:v1', 'product-1');
    h.saves.register('product-1', async () => h.events.push({ type: 'save-current' }));
    h.onFlush(async () => { throw Error('storage unavailable'); });
    await h.api.selectProduct(target);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(h.events.findIndex(event => event.type === 'navigate') < h.events.findIndex(event => event.type === 'flush'));
    assert.equal(h.preferences.get('guan-products:active:v1'), target);
    assert.equal(h.storage.state, 'error');
    assert.deepEqual(h.get().projects.map(project => project.id), ['product-2', 'product-1']);
  } finally { h.restore(); }
});
test('未知产品和未完成hydrate不允许切换/创建；点击当前胶囊无多余写入', async () => {
  const h = navigationHarness('product-1');
  try {
    h.get().createProject();
    h.saves.register('product-1', async () => {});
    await h.api.selectProduct('product-1'); assert.deepEqual(h.events, []);
    await assert.rejects(h.api.selectProduct('missing'), /不存在/);
    h.get().hydrated = false;
    await assert.rejects(h.api.createProduct(), /尚未加载/);
    assert.equal(h.get().projects.length, 1);
    assert.ok(h.events.every(event => event.type !== 'navigate'));
  } finally { h.restore(); }
});
test('保留实例不因父级路由变化重新hydrate；模态开关有产品active门禁', () => {
  const project = candidate('pages/canvas/project.tsx');
  assert.ok(project.includes('if (!hydrated || restoredProjectIdRef.current === projectId) return;'));
  assert.ok(project.includes('if (cancelled) return;'));
  for (const file of ['canvas-config-composer.tsx', 'canvas-prompt-chip-input.tsx', 'canvas-node-prompt-panel.tsx', 'canvas-zoom-controls.tsx', 'canvas-top-bar.tsx', 'canvas-prompt-library.tsx', 'canvas-side-panel.tsx'])
    assert.ok(candidate('components/canvas/' + file).includes('productActive'));
});

test('胶囊基础尺寸、颜色、间距、响应式与旧CSS有效声明一致（不是截图验收）', () => {
  const dependencies = createRequire(join(preview.integration.副本, 'web/package.json'));
  const postcss = createRequire(dependencies.resolve('vite'))('postcss');
  const old = postcss.parse(preview.legacy.get('src/shared/data-contract/index.css'));
  const current = postcss.parse(candidate('guan/产品胶囊.module.css'));
  const normalizeSelector = selector => selector.trim().replace(/\s+/g, ' ').replaceAll(':global(.dark) .root ', 'html[data-workbench-theme="dark"] ')
    .replace(/^\.root /, '').replace(/:global\((\.[^()]+)\)/g, '$1');
  const normalizeValue = value => value.replace(/\s/g, '').replaceAll('#ffffff', '#fff').replace(/0\.(\d+)/g, '.$1');
  const selected = /^\.(?:guan-dc-product-nav(?:::-webkit-scrollbar)?|guan-product-capsule-wrap|guan-dc-product-capsule(?::hover|:active|svg|span)?)(?:\.[\w-]+)?$/;
  function effective(root, local) {
    const result = new Map();
    root.walkRules(rule => {
      const selector = local ? normalizeSelector(rule.selector) : rule.selector.trim();
      if (!(selected.test(selector) || /^\.guan-dc-product-capsule (?:svg|span)$/.test(selector) || /^html\[data-workbench-theme="dark"\] \.guan-dc-product-capsule\./.test(selector))) return;
      const media = rule.parent.type === 'atrule' ? rule.parent.params.replaceAll(' ', '') : '';
      if (media.includes('prefers-reduced-motion')) return;
      for (const declaration of rule.nodes) {
        if (declaration.type !== 'decl') continue;
        const key = JSON.stringify([media, selector, declaration.prop]);
        result.set(key, [normalizeValue(declaration.value), !!declaration.important]);
      }
    });
    return result;
  }
  const expected = effective(old, false), actual = effective(current, true);
  assert.ok(expected.size > 70);
  for (const [key, value] of expected) assert.deepEqual(actual.get(key), value, key);
});

test('胶囊已读规则逐字节迁入：正在查看的任务完成仍有颜色，重新进入才确认', () => {
  const code = candidate('guan/旧版产品胶囊状态.js');
  assert.equal(code, 'export ' + preview.snippets.capsuleStatus.trimEnd() + '\n');
  const read = load(code).readCanvasCapsuleStatus;
  const map = new Map(), storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  const publish = status => map.set('guan-canvas-status:A', JSON.stringify({ status, taskId: 'node', startedAt: 1 }));
  publish('loading'); assert.equal(read('A', true, storage), 'loading');
  publish('error'); assert.equal(read('A', true, storage, true, false), 'error');
  assert.equal(read('A', false, storage), 'error');
  assert.equal(read('A', true, storage), 'idle');
  assert.equal(read('A', false, storage), 'idle');
  publish('success'); assert.equal(read('A', true, storage, false), 'idle');
  assert.equal(read('A', false, storage), 'success');
  assert.equal(read('other', true, storage), 'idle');
  assert.equal(read('A', false, storage), 'success');
});
