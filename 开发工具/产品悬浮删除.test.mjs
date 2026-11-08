import test from 'node:test';
import assert from 'node:assert/strict';
import { ts } from './检查首批功能适配.mjs';
import { 构建产品悬浮删除候选 } from './预审产品悬浮删除.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const preview = 构建产品悬浮删除候选();
const candidate = path => preview.delta.get('web/src/' + path).产物;
function load(source, dependencies = {}) {
  const exports = {}, js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', 'window', js)(exports, name => {
    if (!Object.hasOwn(dependencies, name)) throw Error('未声明测试依赖：' + name);
    return dependencies[name];
  }, { matchMedia: () => ({ matches: true }) }); return exports;
}
const rules = load(readFileSync(join(preview.integration.副本, 'web/src/guan/产品规则.ts'), 'utf8'));
const tasks = load(readFileSync(join(preview.integration.副本, 'web/src/guan/产品任务摘要.js'), 'utf8'));
const recycle = load(candidate('guan/产品回收规则.ts'), { './产品任务摘要.js': tasks, './产品规则': rules });
const project = (id, title = id) => ({ id, title, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z',
  nodes: [{ id: id + '-node', type: 'image', metadata: { content: 'blob:synthetic-image', storageKey: id + '-media' } }],
  connections: [{ id: id + '-edge', fromNodeId: id + '-node', toNodeId: id + '-node2' }],
  chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 13, y: 29, k: 0.7 } });
const initial = () => ({ projects: [project('C'), project('B'), project('A')], deletedProjects: [] });

test('删除B时选择右邻C；归档完整画布、连线和视区，不改其他产品', () => {
  const before = initial(), snapshot = structuredClone(before), after = recycle.planProductRecycle(before, 'B', '2026-10-18T01:00:00Z');
  assert.deepEqual(before, snapshot);
  assert.deepEqual(after.projects.map(p => p.id), ['C', 'A']);
  assert.deepEqual(after.deletedProjects[0].project, before.projects[1]);
  assert.notEqual(after.deletedProjects[0].project, before.projects[1]);
  assert.equal(after.deletedProjects[0].nextProductId, 'C');
  before.projects[1].nodes[0].metadata.content = '后续内存变化';
  assert.equal(after.deletedProjects[0].project.nodes[0].metadata.content, 'blob:synthetic-image');
});
test('删除末尾取左邻；最后一个删除后无虚构后继产品', () => {
  assert.equal(recycle.planProductRecycle(initial(), 'C', 'time').deletedProjects[0].nextProductId, 'B');
  assert.equal(recycle.planProductRecycle({ projects: [project('A')], deletedProjects: [] }, 'A', 'time').deletedProjects[0].nextProductId, '');
});
test('生成中拒绝删除，普通节点不会误当运行任务', () => {
  const state = initial(); state.projects[1].nodes[0].metadata.status = 'loading';
  assert.throws(() => recycle.planProductRecycle(state, 'B', 'time'), /生成任务运行中/);
  state.projects[1].nodes[0].metadata.status = 'idle';
  assert.equal(recycle.planProductRecycle(state, 'B', 'time').projects.length, 2);
});
test('重复删除和重复恢复幂等；恢复保留原产品/节点ID和全部内容', () => {
  const before = initial(), deleted = recycle.planProductRecycle(before, 'B', 'time');
  assert.equal(recycle.planProductRecycle(deleted, 'B', 'other-time'), deleted);
  const restored = recycle.planProductRestore(deleted, 'B');
  assert.deepEqual(restored.projects[0], before.projects[1]);
  assert.equal(restored.deletedProjects.length, 0);
  assert.equal(recycle.planProductRestore(restored, 'B'), restored);
});
test('旧删除标记不能伪造恢复；冲突ID不覆盖；不存在ID报错', () => {
  assert.throws(() => recycle.planProductRestore({ projects: [], deletedProjects: [{ id: 'old', deletedAt: 'time' }] }, 'old'), /没有可恢复/);
  const deleted = recycle.planProductRecycle(initial(), 'B', 'time');
  deleted.projects.push(project('B', '不同内容'));
  assert.throws(() => recycle.planProductRestore(deleted, 'B'), /相同ID/);
  assert.throws(() => recycle.planProductRecycle(initial(), 'missing', 'time'), /已不存在/);
});
test('媒体清理扫描包括回收画布，旧tombstone不冒充媒体快照', () => {
  const deleted = recycle.planProductRecycle(initial(), 'B', 'time');
  deleted.deletedProjects.push({ id: 'old', deletedAt: 'time' });
  const all = recycle.projectsWithRecycleMedia(deleted);
  assert.deepEqual(all.map(p => p.id), ['C', 'A', 'B']);
  assert.equal(all[2].nodes[0].metadata.storageKey, 'B-media');
  assert.match(candidate('stores/use-asset-store.ts'), /projectsWithRecycleMedia\(useCanvasStore.getState\(\)\)/);
});

function operationHarness(activeId = '') {
  let state = { ...initial(), hydrated: true }, blocked = false, blockAt = 0, flushCount = 0;
  const navigations = [], prefs = new Map();
  const port = { getState: () => ({ ...state, openProject: id => state.projects.find(p => p.id === id) || null }), setState: patch => { state = { ...state, ...patch }; } };
  const react = { useCallback: callback => callback, useRef: value => ({ current: value }), useState: value => [value, () => {}],
    useSyncExternalStore: (subscribe, read) => read(), useLayoutEffect: callback => callback() };
  const api = load(candidate('guan/产品操作.ts'), {
    react, 'react-router-dom': { useMatch: () => ({ params: { id: activeId } }), useNavigate: () => id => navigations.push(id) },
    '@/stores/canvas/use-canvas-store': { useCanvasStore: port },
    '@/guan/上游浏览器存储桥': { flushSQLiteStorage: async () => { flushCount++; if (blocked || flushCount === blockAt) throw Error('模拟未确认保存'); }, sqlitePreferences: { getItem: key => prefs.get(key) ?? null, setItem: (key, value) => prefs.set(key, value), removeItem: key => prefs.delete(key) } },
    './产品规则': rules, './产品保存检查点': { ProductCommitCheckpoint: class { mount() {} unmount() {} commit() {} async flush() {} } },
    './产品回收规则': recycle,
  });
  return { api, nav: api.useProductNavigation(), navigations, state: () => state, block: value => { blocked = value; }, blockAt: value => { blockAt = value; } };
}
test('真实操作出口：删除活动B并ACK后进入右邻C，再恢复B并进入B', async () => {
  const h = operationHarness('B'); h.api.useProductCanvasSave('B', {}, () => true, async () => {});
  await h.nav.recycleProduct('B');
  assert.deepEqual(h.navigations, ['/canvas/C']);
  assert.equal(h.state().deletedProjects[0].project.id, 'B');
  await h.nav.restoreProduct('B');
  assert.deepEqual(h.navigations, ['/canvas/C', '/canvas/B']);
});
test('删除非活动产品不跳页，运行控制器在metadata更新前也拒绝删除', async () => {
  const h = operationHarness('A');
  h.api.useProductCanvasSave('B', {}, () => true, async () => {}, () => false);
  await assert.rejects(h.nav.recycleProduct('B'), /生成任务运行中/);
  assert.equal(h.state().projects.length, 3); assert.deepEqual(h.navigations, []);
  const safe = operationHarness('A'); safe.api.useProductCanvasSave('A', {}, () => true, async () => {});
  await safe.nav.recycleProduct('B'); assert.deepEqual(safe.navigations, []);
});
test('保存失败阻止删除和导航，恢复连接后可重试，不清空旧画布', async () => {
  const h = operationHarness(); h.block(true);
  await assert.rejects(h.nav.recycleProduct('B'), /未确认保存/);
  assert.equal(h.state().projects.length, 3); assert.equal(h.state().deletedProjects.length, 0);
  assert.deepEqual(h.navigations, []);
  h.block(false); await h.nav.recycleProduct('B');
  assert.equal(h.state().projects.length, 2); assert.equal(h.state().deletedProjects[0].project.id, 'B');
});
test('归档已入内存但保存失败：保留完整回收快照，不跳页，原操作重试不重复归档', async () => {
  const h = operationHarness('B'); h.api.useProductCanvasSave('B', {}, () => true, async () => {}); h.blockAt(2);
  await assert.rejects(h.nav.recycleProduct('B'), /未确认保存/);
  assert.equal(h.state().projects.length, 2);
  assert.equal(h.state().deletedProjects[0].project.nodes[0].metadata.storageKey, 'B-media');
  assert.deepEqual(h.navigations, []);
  h.blockAt(0); await h.nav.recycleProduct('B');
  assert.equal(h.state().deletedProjects.length, 1); assert.deepEqual(h.navigations, ['/canvas/C']);
});

function generatedMetadata(source, type) {
  const file = ts.createSourceFile('project.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      const props = node.initializer.properties;
      const kind = props.find(p => p.name?.getText(file) === 'type');
      if (kind?.initializer?.getText(file) === 'CanvasNodeType.' + type)
        expression = props.find(p => p.name?.getText(file) === 'metadata')?.initializer?.getText(file);
    }
    ts.forEachChild(node, visit);
  } visit(file);
  assert.ok(expression);
  return new Function('effectivePrompt', 'generationConfig', 'generationStartedAt', 'textCount', 'textIds', 'NODE_STATUS_LOADING', 'buildAudioGenerationMetadata', 'return (' + expression + ')')(
    '合成提示词', { model: 'mock', reasoningEffort: 'auto' }, 123456, 1, ['text1'], 'loading', () => ({ model: 'mock' }),
  );
}
for (const type of ['Text', 'Audio']) test(type + '实际结果对象：复现原缺时间戳，候选保留任务时间和成功胶囊', () => {
  const item = preview.delta.get('web/src/pages/canvas/project.tsx');
  const before = generatedMetadata(item.原文, type), after = generatedMetadata(item.产物, type);
  assert.equal(before.generationStartedAt, undefined); assert.equal(after.generationStartedAt, 123456);
  const node = { id: 'generated', type: type.toLowerCase(), metadata: { ...after, status: 'success', texts: type === 'Text' ? [{ id: 'text1', status: 'success', content: '模拟完成' }] : undefined } };
  assert.equal(tasks.canvasTaskSummary([node]).status, 'success');
});
test('十文件候选保持按钮兄弟关系、原删除SVG与触屏/焦点入口，保留原作者源码', () => {
  assert.equal(preview.delta.size, 10);
  assert.match(candidate('guan/顶部产品胶囊.tsx'), /<\/button>\s*<button type="button" className="guan-product-delete"/);
  assert.match(candidate('guan/产品回收面板.tsx'), /M4 7h16M10 11v6M14 11v6M6.5 7l.8 12h9.4l.8-12M9 7l1-3h4l1 3/);
  const css = candidate('guan/产品胶囊.module.css');
  assert.match(css, /focus-within/); assert.match(css, /@media \(hover: none\)/); assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /width: 24px/); assert.match(css, /height: 24px/);
  assert.ok([...preview.delta.keys()].every(path => path.startsWith('web/src/')));
});

function renderEntry({ routeId, archived = true }) {
  const state = { hydrated: true, projects: [project('C')], deletedProjects: archived ? [{ id: 'B', project: project('B') }] : [] };
  const api = load(candidate('guan/画布入口.tsx'), {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'react-router-dom': { Navigate: 'Navigate', useMatch: () => routeId ? { params: { id: routeId } } : null },
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
    antd: { App: { useApp: () => ({ message: { error() {} } }) } },
    '@/stores/canvas/use-canvas-store': { useCanvasStore: selector => selector(state) },
    '@/stores/use-theme-store': { useThemeStore: selector => selector({ theme: 'light' }) },
    './上游浏览器存储桥': { sqlitePreferences: { getItem: () => 'C' } },
    './产品操作': { ACTIVE_PRODUCT_KEY: 'synthetic', useProductNavigation: () => ({ busy: false, createProduct() {} }) },
    './产品规则': rules, './工作台首页': { WorkbenchHome: 'WorkbenchHome' },
  }); return api.CanvasEntry();
}
test('删除保存失败时入口不绕过操作出口自动跳页；正常首页恢复行为不变', () => {
  assert.equal(renderEntry({ routeId: 'B' }).type, 'WorkbenchHome');
  assert.equal(renderEntry({ routeId: undefined }).type, 'Navigate');
  assert.equal(renderEntry({ routeId: 'missing', archived: false }).type, 'Navigate');
});
