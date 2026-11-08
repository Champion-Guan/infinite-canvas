import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ts } from './检查首批功能适配.mjs';
import { 构建视区跟随候选, 视区跟随项目路径 } from './预审新建卡片视区跟随.mjs';
import { 卡片布局旧目录 } from './预审卡片自动避让.mjs';

const preview = 构建视区跟随候选();
const before = preview.delta.get(视区跟随项目路径).原文;
const candidate = preview.delta.get(视区跟随项目路径).产物;
const old = preview.legacy.source;
const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, '真实源码边界必须存在');
  return source.slice(a, b);
}
function fn(source, name) {
  const ast = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(found.length, 1);
  return found[0];
}
const root = preview.integration.副本;
const nodeType = new Function(transpile(between(readFileSync(join(root, 'web/src/types/canvas.ts'), 'utf8'),
  'export enum CanvasNodeType', '// Node types are open').replace('export ', '')) + ';return CanvasNodeType;')();
const specs = readFileSync(join(root, 'web/src/constant/canvas.ts'), 'utf8');
assert.equal(specs, readFileSync(join(卡片布局旧目录, 'src/canvas/constant/canvas.ts'), 'utf8'));
const getNodeSpec = new Function('CanvasNodeType', 'i18n', 'getRegistryNodeSpec',
  transpile(specs.replace(/^import .*;\n/gm, '').replace(/^export /gm, '')) + ';return getNodeSpec;')(
  nodeType, { t: text => text }, () => { throw Error('本测试不调用插件'); },
);
const factory = readFileSync(join(root, 'web/src/lib/canvas/canvas-node-factory.ts'), 'utf8');
assert.equal(fn(factory, 'createCanvasNode'), fn(readFileSync(join(卡片布局旧目录, 'src/canvas/lib/canvas/canvas-node-factory.ts'), 'utf8'), 'createCanvasNode'));
let sequence = 0;
const rawFactory = new Function('getNodeSpec', 'Date', 'Math', transpile(fn(factory, 'createCanvasNode').replace('export ', '')) + ';return createCanvasNode;')(
  getNodeSpec, { now: () => ++sequence }, { random: () => 0.123456 },
);
const geometryText = readFileSync(join(root, 'web/src/guan/卡片自动避让.ts'), 'utf8');
const geometryExports = {};
new Function('exports', transpile(geometryText))(geometryExports);

// 执行项目真实createNode、统一避让事务及旧useLayoutEffect；只模拟React hooks和状态提交。
function harness(source, { view = { x: 0, y: 0, k: 1 }, size = { width: 1200, height: 720 }, initial = [] } = {}) {
  let nodes = initial, viewport = { ...view }, effect, id = 0;
  const panels = [], pans = [], selection = [], created = [];
  const reveal = { current: null }, viewportRef = { current: viewport };
  const stateCode = between(source, 'const [nodes, setNodeState]', 'const [connections, setConnections]');
  const api = new Function('useState', 'useRef', 'useCallback', 'placeNewCanvasNodes',
    transpile(stateCode) + ';return {setNodes,setRawNodes,nodesRef};')(
    () => [initial, next => { nodes = next; }], value => ({ current: value }), cb => cb, geometryExports.placeNewCanvasNodes,
  );
  const location = between(source, 'const screenToCanvas = useCallback(', '    const setConnecting = useCallback(');
  const rect = { left: 73, top: 84, width: size.width, height: size.height };
  const getCanvasCenter = new Function('useCallback', 'containerRef', 'viewportRef', 'size',
    transpile(location) + ';return getCanvasCenter;')(cb => cb, { current: { getBoundingClientRect: () => rect } }, viewportRef, size);
  const createCode = between(source, 'const createNode = useCallback(', '\n    const deleteNodes = useCallback(').split('    useLayoutEffect(() => {')[0];
  const names = ['useCallback', 'useLayoutEffect', 'viewportRef', 'revealCreatedNodeRef', 'size', 'getCanvasCenter',
    'CanvasNodeType', 'effectiveConfig', 'getGenerationCount', 'createCanvasNode', 'placeCanvasNode', 'nodesRef', 'setNodes',
    'setSelectedNodeIds', 'setSelectedConnectionId', 'getNodeDefinition', 'isBuiltinType', 'setDialogNodeId',
    'PROMPT_VARIABLES_NODE_TYPE', 'buildPromptVariablesMetadata'];
  const values = [cb => cb, cb => { effect = cb; }, viewportRef, reveal, size, getCanvasCenter,
    nodeType, { model: 'synthetic', size: 'auto', count: 1 }, value => value,
    (...args) => { const node = { ...rawFactory(...args), id: 'synthetic-' + ++id }; created.push(node); return node; },
    geometryExports.placeCanvasNode, api.nodesRef, api.setNodes,
    value => selection.push([...value]), () => {}, () => undefined, type => Object.values(nodeType).includes(type),
    value => panels.push(value), 'not-a-builtin', () => { throw Error('不得迁入提示词变量'); }];
  const create = new Function(...names, transpile(createCode) + ';return createNode;')(...values);
  const effectBody = source.includes('const id = revealCreatedNodeRef.current;')
    ? between(source, '    useLayoutEffect(() => {\n        const id = revealCreatedNodeRef.current;', '    const deleteNodes = useCallback(') : null;
  const layout = () => {
    if (!effectBody) return;
    new Function('useLayoutEffect', 'revealCreatedNodeRef', 'nodes', 'viewportRef', 'size', 'setViewport', transpile(effectBody))(
      cb => { effect = cb; }, reveal, nodes, viewportRef, size,
      next => { viewport = next; viewportRef.current = next; pans.push(next); },
    );
    effect();
  };
  return { create, layout, api, reveal, panels, pans, selection, created,
    read: () => nodes, view: () => viewport,
    step(type = 'text', position) { create(type, position); layout(); return nodes.at(-1); },
  };
}
const normalize = run => ({ nodes: run.read(), viewport: run.view(), panels: run.panels, selection: run.selection });

test('一文件三片段边界：来源原字节保留，反向移除后完全等于前置', () => {
  assert.deepEqual([...preview.delta.keys()], [视区跟随项目路径]);
  let restored = candidate;
  for (const text of [preview.legacy.ref, preview.legacy.mark + '\n', preview.legacy.effect + '\n']) {
    assert.equal(restored.split(text).length, 2);
    restored = restored.replace(text, '');
  }
  assert.ok(restored === before, '只移除三个新增片段后须逐字节恢复完整前置');
  assert.ok(candidate.includes('size.width, size.height, setNodes],'));
  assert.ok(!candidate.includes('promptVariablesMetadata'));
  assert.equal((candidate.match(/revealCreatedNodeRef\.current = newNode\.id;/g) || []).length, 1);
});

test('回归先复现：第4张超出视区时旧版平移-288，新版漏迁时不跟随', () => {
  const legacy = harness(old), unfixed = harness(before), fixed = harness(candidate);
  for (let i = 0; i < 4; i++) { legacy.step(); unfixed.step(); fixed.step(); }
  assert.deepEqual(legacy.read(), unfixed.read());
  assert.deepEqual(legacy.view(), { x: 0, y: -288, k: 1 });
  assert.deepEqual(unfixed.view(), { x: 0, y: 0, k: 1 });
  assert.deepEqual(normalize(fixed), normalize(legacy));
  for (let i = 0; i < 2; i++) { legacy.step(); unfixed.step(); fixed.step(); }
  assert.deepEqual(fixed.read().map(node => node.position), [
    { x: 430, y: 240 }, { x: 42, y: 240 }, { x: 818, y: 240 },
    { x: 430, y: 528 }, { x: 42, y: 528 }, { x: 818, y: 528 },
  ]);
  assert.notDeepEqual(unfixed.read().map(node => node.position), fixed.read().map(node => node.position));
  assert.deepEqual(normalize(fixed), normalize(legacy));
});

for (const k of [0.5, 1, 2]) {
  test(`平移与${k}倍缩放：连续16张和旧实现的坐标、视区及面板一致`, () => {
    const options = { view: { x: -713, y: 207, k } };
    const legacy = harness(old, options), fixed = harness(candidate, options);
    for (let i = 0; i < 16; i++) {
      legacy.step(); fixed.step();
      assert.deepEqual(normalize(fixed), normalize(legacy));
      assert.equal(fixed.view().k, k);
    }
  });
}

for (const type of Object.values(nodeType)) {
  test(`${type}创建：连续6张旧版位置/选择/面板规则不变`, () => {
    const legacy = harness(old), fixed = harness(candidate);
    for (let i = 0; i < 6; i++) { legacy.step(type); fixed.step(type); }
    assert.deepEqual(normalize(fixed), normalize(legacy));
    assert.equal(fixed.panels.length, ['image', 'video', 'config'].includes(type) ? 6 : 0);
  });
}

test('已在可视区的卡片不平移；标记消费后改尺寸、拖动和恢复不抢镜头', () => {
  const run = harness(candidate);
  run.step();
  assert.equal(run.pans.length, 0);
  assert.equal(run.reveal.current, null);
  const changed = run.read().map(node => ({ ...node, position: { x: -2000, y: 9000 }, width: 900 }));
  run.api.setNodes(changed); run.layout();
  run.api.setRawNodes([]); run.layout();
  run.api.setRawNodes(changed); run.layout();
  assert.equal(run.pans.length, 0);
});

test('后台结果与尺寸回填仍避让但不产生创建标记或视区跳动', () => {
  const run = harness(candidate);
  const node = { ...rawFactory('image', { x: -5000, y: 9000 }), id: 'background', metadata: { generationStartedAt: 1, status: 'loading' } };
  run.api.setNodes([node]); run.layout();
  run.api.setNodes(previous => previous.map(item => ({ ...item, width: 1000, metadata: { ...item.metadata, status: 'success', content: 'synthetic.png' } })));
  run.layout();
  assert.equal(run.reveal.current, null);
  assert.equal(run.pans.length, 0);
});

test('使用最终事务坐标：同帧异步插入导致二次避让后仍聚焦实际落点', () => {
  const run = harness(candidate);
  run.create('text', { x: -1000, y: -2000 });
  const created = run.created[0];
  const obstacle = { ...created, id: 'concurrent-obstacle' };
  // 模拟创建标记设置后、React提交前同一事务中加入另一张卡片。
  run.api.setRawNodes([obstacle]);
  run.api.setNodes(previous => [...previous, created]);
  const final = run.read().find(node => node.id === created.id);
  assert.notDeepEqual(final.position, created.position);
  run.layout();
  assert.deepEqual(run.view(), { x: 600 - (final.position.x + final.width / 2), y: 360 - (final.position.y + final.height / 2), k: 1 });
  assert.equal(run.reveal.current, null);
});

test('边界严格沿用旧版：四边恰好到线不动、越界1px才居中且只执行一次', () => {
  for (const position of [{ x: 24, y: 64 }, { x: 828, y: 380 }]) {
    const run = harness(candidate);
    run.create('text', { x: position.x + 170, y: position.y + 120 }); run.layout();
    assert.equal(run.pans.length, 0);
  }
  for (const position of [{ x: 23, y: 64 }, { x: 24, y: 63 }, { x: 829, y: 380 }, { x: 828, y: 381 }]) {
    const run = harness(candidate);
    run.create('text', { x: position.x + 170, y: position.y + 120 }); run.layout(); run.layout();
    assert.equal(run.pans.length, 1);
  }
});

test('同一React提交批量创建仅跟随最后一次手动创建，与旧版一致', () => {
  const legacy = harness(old), fixed = harness(candidate);
  for (const run of [legacy, fixed]) {
    for (let i = 0; i < 8; i++) run.create('text');
    run.layout();
  }
  assert.deepEqual(normalize(fixed), normalize(legacy));
  assert.equal(fixed.pans.length, 1);
});
