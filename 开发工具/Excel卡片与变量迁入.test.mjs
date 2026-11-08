import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { 根目录 } from './公共.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 读取Excel卡片旧来源, 提取Excel卡片片段, 构建Excel卡片候选 } from './预审Excel卡片与变量迁入.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';

const sources = 读取Excel卡片旧来源(), snippets = 提取Excel卡片片段(sources);
const own = name => readFileSync(join(根目录, '扩展功能/Excel画布', name), 'utf8');
function load(source, imports = {}, extra = {}) {
  const context = vm.createContext({ exports: {}, require: name => {
    if (!(name in imports)) throw Error('测试拒绝未声明模块：' + name);
    return imports[name];
  }, structuredClone, console, ...extra });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context.exports;
}
const clean = value => JSON.parse(JSON.stringify(value));
const themes = load(snippets.generated.get('旧版主题翻译.js'));
const rules = load(snippets.generated.get('旧版参数规则.ts'), { './旧版主题翻译.js': themes });
const contextModule = load(own('Excel卡片上下文.ts'), { './旧版参数规则': rules });
const sync = load(snippets.generated.get('旧版提示词同步.ts'), { './旧版参数规则': rules }).syncExcelPromptNodes;
const titles = load(snippets.generated.get('旧版最终提示词标题.ts'));
const domain = load(own('Excel卡片事务.ts'), { './旧版参数规则': rules, './旧版最终提示词标题': titles, './Excel卡片上下文': contextModule });
const placement = load(readFileSync(join(根目录, '扩展功能/画布布局/卡片自动避让.ts'), 'utf8'));
const oldRules = load(snippets.rawRules, { '@/lib/canvas/parameter-memory': {} }, { localizePromptTheme: themes.localizePromptTheme });

const template = (id = 't1', route = '同名 | 金属', row = 3, prompts = { 'Main Prompt': 'Theme: full product hero\nShow [PRODUCT NAME]', 'Detail Prompt 01': 'Theme: dimension display\n[DIMENSIONS] and [CORE FEATURE 1]', 'Video Prompt': 'Show video [PRODUCT NAME]' }) => ({ id, route, sourceRowNumber: row, prompts });
function snapshot() {
  return { projects: [{ id: 'a', title: '任意手改产品名', productSetId: 'book' }, { id: 'b', title: '同名 | 塑料', productSetId: 'book' }],
    guanWorkbooks: { contract: { workspace: { activeProductId: 'b', activeProductSetId: 'book' },
      products: [{ id: 'a', productSetId: 'book', sourceRowNumber: 3, identity: { titleZh: '同名 | 金属' } }, { id: 'b', productSetId: 'book', sourceRowNumber: 4, identity: { titleZh: '同名 | 塑料' } }],
      productSets: [{ id: 'book', source: { fileName: '测试.xlsx', role: 'prompt-products', promptTemplates: [template(), template('t2', '同名 | 塑料', 4, { 'Main Prompt': 'Only plastic [NAME]' })] } }] } } };
}
const context = () => contextModule.productExcelContext(snapshot(), 'a');
let id = 0;
const factory = { create(type, center, metadata) {
  const [width, height] = type === rules.PROMPT_VARIABLES_NODE_TYPE ? [420, 520] : [340, 240];
  return { id: 'new-' + ++id, type, title: type, position: { x: center.x - width / 2, y: center.y - height / 2 }, width, height, metadata };
}, edgeId: () => 'edge-' + ++id, place: placement.placeCanvasNode };
const parameter = () => domain.createProductParameterNode(context(), { x: -600, y: 200 }, { '[PRODUCT NAME]': '真实产品', '[DIMENSIONS]': '10×20cm', '[CORE FEATURE 1]': '非尺寸主视觉' }, factory);
const insert = (nodes = [], edges = [], request = {}, ctx = context(), confirm = () => false) => domain.insertExcelPromptCards(nodes, edges, ctx, { productId: ctx.productId, ...request }, { x: 300, y: 300 }, factory, confirm, sync);

test('旧翻译文件逐字迁入，参数纯规则与旧版一致', () => {
  assert.equal(snippets.generated.get('旧版主题翻译.js'), sources.get('lib/canvas/prompt-theme-labels.js'));
  for (const prompt of ['Theme: full product hero\n[PRODUCT NAME]', 'Theme: dimension display\n[DIMENSIONS] [CORE FEATURE 1]', 'Unknown [x] [待填写] [node:a] [x]']) {
    assert.deepEqual(clean(rules.promptVariableTokens(prompt)), clean(oldRules.promptVariableTokens(prompt)));
    assert.deepEqual(clean(rules.parseExcelPromptSpec('Detail Prompt 01', prompt)), clean(oldRules.parseExcelPromptSpec('Detail Prompt 01', prompt)));
    assert.equal(rules.resolvePromptVariables(prompt, { '[DIMENSIONS]': '10cm' }), oldRules.resolvePromptVariables(prompt, { '[DIMENSIONS]': '10cm' }));
  }
  assert.deepEqual(clean(rules.buildPromptVariablesMetadata(context(), undefined, undefined, { '[PRODUCT NAME]': 'A' })), clean(oldRules.buildPromptVariablesMetadata(context(), undefined, undefined, { '[PRODUCT NAME]': 'A' })));
});
test('当前产品用稳定ID而不是全局选择或人工标题读取Excel', () => {
  const value = context(); assert.equal(value.productId, 'a'); assert.equal(value.templates[0].id, 't1'); assert.equal(value.activeProductName, '同名');
  assert.equal(contextModule.productExcelContext(snapshot(), 'b').templates[0].prompts['Main Prompt'], 'Only plastic [NAME]');
});
test('相同完整路线按原行号消歧，不借另一个同名产品', () => {
  const s = snapshot(); s.guanWorkbooks.contract.productSets[0].source.promptTemplates = [template(), template('same', '同名 | 金属', 8, { 'Main Prompt': 'row8' })];
  s.guanWorkbooks.contract.products[0].sourceRowNumber = 8;
  assert.equal(contextModule.productExcelContext(s, 'a').templates[0].id, 'same');
  s.guanWorkbooks.contract.products[0].sourceRowNumber = 9;
  assert.equal(contextModule.productExcelContext(s, 'a').templates.length, 0);
});
test('Excel已移除的产品行、未归属产品和未知ID都不借提示词', () => {
  const s = snapshot(); s.guanWorkbooks.contract.productSets[0].source.promptTemplates.shift();
  assert.equal(contextModule.productExcelContext(s, 'a').templates.length, 0);
  s.projects[0].productSetId = null; assert.equal(contextModule.productExcelContext(s, 'a').templates.length, 0);
  assert.equal(contextModule.productExcelContext(s, 'missing').templates.length, 0);
});
test('列表保留旧标题、双位编号、主题/角度与画面任务摘要', () => {
  const items = contextModule.excelPromptItems(context());
  assert.match(items[0].title, /同名 · 主图提示词 · 完整产品主图/);
  assert.match(items[1].title, /详情页提示词01 · 尺寸展示/);
  assert.match(items[1].preview, /主题\/角度：尺寸展示/);
});
test('变量忽略节点引用/待填说明，大小写/下划线等价，未知值不编造', () => {
  assert.deepEqual(clean(rules.promptVariableTokens('[NAME] [NAME] [node:a] [1] [待填写] [1-2秒]')), ['[NAME]']);
  assert.equal(rules.resolvePromptVariables('[product_name] [MISSING]', { '[PRODUCT NAME]': '真实值' }), '真实值 [MISSING]');
  assert.match(rules.variableLabel('[TECH XYZ]'), /变量 \[TECH XYZ\]/);
});
test('尺寸主题优先使用真实尺寸、不由核心卖点取代，缺尺寸明确保留', () => {
  const text = rules.resolvePromptVariables('Theme: dimension display\n[DIMENSIONS] [CORE FEATURE 1]', { '[DIMENSIONS]': '10cm', '[CORE FEATURE 1]': '耐用' });
  assert.match(text, /已确认尺寸参数/); assert.match(text, /核心卖点只作背景参考/); assert.match(text, /10cm/);
  assert.match(rules.resolvePromptVariables('Theme: dimension display\n[DIMENSIONS]'), /未填写尺寸参数/);
});
test('参数卡默认420×520并继承旧参数元数据', () => {
  const node = parameter(); assert.equal(node.width, 420); assert.equal(node.height, 520);
  assert.equal(node.metadata.promptVariableProductName, '同名'); assert.equal(node.metadata.promptVariableValues['[DIMENSIONS]'], '10×20cm');
});
test('一键导入默认跳过视频、开关启用才包含视频', () => {
  assert.equal(insert().nodes.length, 2);
  assert.equal(insert([], [], { includeVideo: true }).nodes.length, 3);
});
test('单列插入不自动连接，参数卡由用户创建/连接', () => {
  const p = parameter(), result = insert([p], [], { templateId: 't1', key: 'Main Prompt' });
  assert.equal(result.nodes.length, 2); assert.equal(result.connections.length, 0);
});
test('已有参数卡的一键导入建立两份最终预览和四条边', () => {
  const result = insert([parameter()]);
  assert.equal(result.nodes.length, 5); assert.equal(result.connections.length, 4);
  assert.equal(result.nodes.filter(node => node.metadata?.promptVariablePreviewOf).length, 2);
  assert.ok(result.nodes.some(node => node.metadata?.content?.includes('真实产品')));
});
test('重复一键导入和重复连接不新增卡片或边', () => {
  const first = insert([parameter()]); const second = insert(first.nodes, first.connections);
  assert.equal(second.nodes.length, first.nodes.length); assert.equal(second.connections.length, first.connections.length);
  const source = second.nodes.find(node => node.metadata?.excelPromptKey), p = second.nodes.find(node => node.type === rules.PROMPT_VARIABLES_NODE_TYPE);
  const third = domain.bindExcelParameters(second.nodes, second.connections, p.id, source.id, factory);
  assert.equal(third.nodes.length, second.nodes.length); assert.equal(third.connections.length, second.connections.length);
});
test('相同文字的两个Excel列仍各有身份，不误合并', () => {
  const ctx = { ...context(), templates: [template('t1', '同名', 3, { 'Main Prompt': 'same', 'Detail Prompt 01': 'same' })] };
  assert.equal(insert([], [], {}, ctx).nodes.length, 2);
});
test('过期产品拖入请求/不存在的模板列均拒绝，原数组不改', () => {
  const original = [parameter()], saved = JSON.stringify(original);
  assert.throws(() => insert(original, [], { productId: 'b' }), /产品已切换/);
  assert.throws(() => insert(original, [], { templateId: 'wrong', key: 'Main Prompt' }), /没有匹配/);
  assert.throws(() => insert(original, [], { templateId: 't1', key: '' }), /身份不完整/);
  assert.throws(() => insert(original, [], { key: 'Main Prompt' }), /身份不完整/);
  assert.equal(JSON.stringify(original), saved);
});
test('新卡/预览避让不改变已有卡片坐标，目标卡片不跳走', () => {
  const p = parameter(), occupied = factory.create('text', { x: 500, y: 300 }, { content: '客户已摆放内容' });
  const before = clean([p, occupied]); const result = insert([p, occupied]);
  assert.deepEqual(clean(result.nodes.find(node => node.id === p.id).position), before[0].position);
  assert.equal(result.nodes.find(node => node.id === occupied.id), occupied);
  for (let a = 0; a < result.nodes.length; a++) for (let b = a + 1; b < result.nodes.length; b++) assert.equal(placement.nodesOverlap(result.nodes[a], result.nodes[b]), false);
});
test('重传更新原卡与预览，保留ID、坐标和其他客户卡片', () => {
  const first = insert([parameter()]), ctx = context(); ctx.templates[0].prompts['Main Prompt'] = 'Changed [PRODUCT NAME]';
  const next = sync(first.nodes, ctx, assert.fail);
  assert.equal(next.length, first.nodes.length);
  for (const node of first.nodes) assert.deepEqual(clean(next.find(item => item.id === node.id).position), clean(node.position));
  const source = next.find(node => node.metadata?.excelPromptKey === 'Main Prompt');
  assert.equal(source.metadata.content, 'Changed [PRODUCT NAME]');
  assert.equal(next.find(node => node.metadata?.promptVariableSourceNodeId === source.id && node.metadata?.promptVariablePreviewOf).metadata.content, 'Changed 真实产品');
});
test('手改后拒绝覆盖记住本次新值，不反复打扰；后台产品延后询问', () => {
  const first = insert(), ctx = context(); first.nodes[0].metadata.content = '客户手改'; ctx.templates[0].prompts['Main Prompt'] = 'New content';
  let asked = 0; const next = sync(first.nodes, ctx, () => { asked++; return false; });
  assert.equal(next[0].metadata.content, '客户手改'); assert.equal(asked, 1);
  assert.equal(sync(next, ctx, assert.fail), next);
  const delayed = sync(first.nodes, ctx, () => undefined); assert.equal(delayed, first.nodes);
});
test('删除Excel列不擦除既有提示词卡片', () => {
  const first = insert(), ctx = context(); delete ctx.templates[0].prompts['Main Prompt'];
  assert.equal(sync(first.nodes, ctx, assert.fail), first.nodes);
});
test('手动编辑源文字同步最终预览，不改其他节点及位置', () => {
  const first = insert([parameter()]), source = first.nodes.find(node => node.metadata?.excelPromptKey === 'Main Prompt');
  const changed = first.nodes.map(node => node.id === source.id ? { ...node, metadata: { ...node.metadata, content: 'Manual [PRODUCT NAME]' } } : node);
  const next = domain.reconcileExcelPreviews(first.nodes, changed);
  assert.equal(next.find(node => node.metadata?.promptVariablePreviewOf && node.metadata.promptVariableSourceNodeId === source.id).metadata.content, 'Manual 真实产品');
  const moved = first.nodes.map(node => ({ ...node, position: { x: node.position.x + 1, y: node.position.y } }));
  const noContentChange = domain.reconcileExcelPreviews(first.nodes, moved);
  assert.ok(noContentChange.every((node, index) => node === moved[index]));
});
test('删除源或参数级联最终预览、清空悬空关系，原历史快照可完整恢复', () => {
  for (const type of ['source', 'parameter']) {
    const first = insert([parameter()]), history = JSON.stringify(first);
    const target = first.nodes.find(node => type === 'source' ? node.metadata?.excelPromptKey : node.type === rules.PROMPT_VARIABLES_NODE_TYPE);
    const ids = domain.excelDeletionIds(first.nodes, new Set([target.id]));
    const left = first.nodes.filter(node => !ids.has(node.id)).map(node => domain.clearDeletedExcelRelations(node, ids));
    assert.ok(left.every(node => !ids.has(node.metadata?.excelPromptBindingNodeId) && !ids.has(node.metadata?.promptVariableSourceNodeId) && !ids.has(node.metadata?.promptVariablePreviewNodeId)));
    assert.equal(JSON.stringify(first), history);
  }
});
test('断开参数边移除对应预览、保留另一来源，允许重新连接', () => {
  const first = insert([parameter()]), edge = first.connections[0];
  const next = domain.disconnectExcelParameters(first.nodes, first.connections, edge.id);
  assert.equal(next.nodes.length, 4); assert.equal(next.connections.length, 2);
  const rebound = domain.bindExcelParameters(next.nodes, next.connections, edge.fromNodeId, edge.toNodeId, factory);
  assert.equal(rebound.nodes.length, 5); assert.equal(rebound.connections.length, 4);
});
test('另一参数卡不能静默抢走已有绑定', () => {
  const first = insert([parameter()]), extra = parameter(), source = first.nodes.find(node => node.metadata?.excelPromptKey);
  assert.throws(() => domain.bindExcelParameters([...first.nodes, extra], first.connections, extra.id, source.id, factory), /另一张参数卡/);
});
test('复制整套卡片重新映射绑定，不让新预览仍指向旧来源', () => {
  const first = insert([parameter()]);
  const ids = new Map(first.nodes.map(node => [node.id, 'copy-' + node.id]));
  const copied = first.nodes.map(node => domain.remapCopiedExcelRelations({ ...node, id: ids.get(node.id) }, ids));
  const source = copied.find(node => node.metadata?.excelPromptKey === 'Main Prompt');
  const preview = copied.find(node => node.metadata?.promptVariablePreviewOf && node.metadata.promptVariableSourceNodeId === source.id);
  assert.ok(preview); assert.equal(preview.metadata.promptVariablePreviewOf, source.metadata.excelPromptBindingNodeId);
  const p = first.nodes.find(node => node.type === rules.PROMPT_VARIABLES_NODE_TYPE);
  const onlyParameter = domain.remapCopiedExcelRelations({ ...p, id: 'copy' }, new Map([[p.id, 'copy']]));
  assert.equal(onlyParameter.metadata.promptVariableSourceNodeId, undefined);
  assert.equal(onlyParameter.metadata.promptVariableValues['[PRODUCT NAME]'], '真实产品');
});
test('批量规划中途失败不发布半批、原节点和边保持原样', () => {
  const original = [parameter()], before = JSON.stringify(original); let calls = 0;
  const failing = { ...factory, create(...args) { if (++calls === 2) throw Error('合成创建故障'); return factory.create(...args); } };
  assert.throws(() => domain.insertExcelPromptCards(original, [], context(), { productId: 'a' }, { x: 300, y: 300 }, failing, () => false, sync), /合成创建故障/);
  assert.equal(JSON.stringify(original), before);
});

function memoryHarness() {
  const cache = new Map(), writes = [];
  return { cache, writes, memory: load(own('Excel参数记忆.ts'), { './上游浏览器存储桥': { sqlitePreferences: { getItem: key => cache.get(key) ?? null, setItem: (key, value) => { cache.set(key, value); writes.push([key, value]); } } } }) };
}
test('SQLite参数记忆按产品隔离，保留未出现的字段和显式清空', () => {
  const { memory } = memoryHarness();
  memory.saveProductParameterValues('a', { '[NAME]': 'A', '[OLD]': '保留' }); memory.saveProductParameterValues('b', { '[NAME]': 'B' });
  memory.saveProductParameterValues('a', { '[NAME]': '' });
  assert.deepEqual(clean(memory.readProductParameterValues('a')), { '[NAME]': '', '[OLD]': '保留' });
  assert.equal(memory.readProductParameterValues('b')['[NAME]'], 'B');
});
test('空ID/损坏参数拒绝而非作为空值覆盖，不回退浏览器存储', () => {
  const { memory, cache, writes } = memoryHarness();
  assert.throws(() => memory.saveProductParameterValues('', {}), /缺少产品/);
  cache.set(memory.parameterMemoryKey('a'), '{bad');
  assert.throws(() => memory.readProductParameterValues('a'), /损坏/);
  assert.throws(() => memory.saveProductParameterValues('a', { '[NAME]': 'new' }), /损坏/);
  assert.equal(writes.length, 0);
});

function uiHarness(initial) {
  let nodes = initial.nodes;
  const { memory } = memoryHarness(); const effects = [];
  const jsx = (type, props) => ({ type, props });
  const ui = load(snippets.generated.get('旧版参数卡片.tsx'), {
    react: { useEffect: callback => effects.push(callback), useMemo: callback => callback() },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { Braces: 'braces' }, antd: { Button: 'button' },
    '@/lib/canvas-theme': { canvasThemes: { light: { node: { text: 'black', stroke: 'gray' }, toolbar: { itemHover: 'gray', activeText: 'black' } } } },
    '@/stores/use-theme-store': { useThemeStore: fn => fn({ theme: 'light' }) },
    './旧版参数规则': rules, './Excel画布上下文': { useExcelProductId: () => 'a', useExcelPromptContext: () => context() }, './Excel参数记忆': memory,
  });
  const ctx = { node: nodes.find(node => node.type === rules.PROMPT_VARIABLES_NODE_TYPE), getNode: id => nodes.find(node => node.id === id), getNodes: () => nodes, getConnections: () => initial.connections,
    updateMetadata: patch => { nodes = nodes.map(node => node.id === ctx.node.id ? { ...node, metadata: { ...node.metadata, ...patch } } : node); },
    applyOps: ops => { nodes = nodes.map(node => { const op = ops.find(op => op.id === node.id); return op ? { ...node, metadata: { ...node.metadata, ...op.metadata } } : node; }); } };
  const tree = ui.PromptVariablesContent({ ctx });
  function find(item, predicate) {
    if (!item || typeof item !== 'object') return null;
    if (predicate(item)) return item;
    for (const child of Array.isArray(item) ? item : [item.props?.children]) { const result = find(child, predicate); if (result) return result; }
    return null;
  }
  return { nodes: () => nodes, memory, effects, input: token => find(tree, node => node.type === 'input' && node.props.placeholder === token), ai: find(tree, node => node.type === 'button' && node.props.children === 'AI 校准主题') };
}
test('执行迁入的真实参数卡onChange：同步全部来源和最终预览，清空值也保存', () => {
  const first = insert([parameter()]), h = uiHarness(first);
  h.input('[PRODUCT NAME]').props.onChange({ target: { value: '实时新产品' } });
  assert.equal(h.memory.readProductParameterValues('a')['[PRODUCT NAME]'], '实时新产品');
  const preview = h.nodes().find(node => node.metadata?.promptVariablePreviewOf && node.metadata?.content?.includes('实时新产品'));
  assert.ok(preview);
  h.input('[PRODUCT NAME]').props.onChange({ target: { value: '' } });
  assert.equal(h.memory.readProductParameterValues('a')['[PRODUCT NAME]'], '');
});
test('AI校准明确禁用，不带入真实收费网络调用', () => {
  const h = uiHarness(insert([parameter()])); assert.equal(h.ai.props.disabled, true); assert.match(h.ai.props.title, /受限凭据网关/);
  assert.doesNotMatch(snippets.generated.get('旧版参数卡片.tsx'), /requestImageQuestion|runTaskActivity|useEffectiveConfig/);
});
test('SQLite真实分片保存及冷重开保留节点/预览/绑定与产品参数记忆', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'guan-excel-cards-test-'));
  let workspace = openWorkspace({ dataRoot, initialize: true });
  const client = { readDocument: async (...args) => workspace.readDocument(...args), writeDocument: async input => workspace.writeDocument(input) };
  let app = createRecoverableShardedApplicationStorage({ client });
  const value = insert([parameter()]), key = 'infinite-canvas:canvas_store';
  const payload = JSON.stringify({ state: { projects: [{ id: 'a', ...value }], deletedProjects: [], guanWorkbooks: snapshot().guanWorkbooks }, version: 0 });
  try {
    await app.createInstance({ storeName: 'app_state' }).setItem(key, payload);
    await app.createInstance({ storeName: 'preferences' }).setItem('guan-canvas-parameter-values:a', JSON.stringify({ '[NAME]': '测试值' })); await app.flush();
    app.close(); workspace.close(); workspace = openWorkspace({ dataRoot }); app = createRecoverableShardedApplicationStorage({ client });
    assert.equal(await app.createInstance({ storeName: 'app_state' }).getItem(key), payload);
    assert.equal(JSON.parse(await app.createInstance({ storeName: 'preferences' }).getItem('guan-canvas-parameter-values:a'))['[NAME]'], '测试值');
    console.log('Excel卡片合成SQLite冷重开证据：' + dataRoot);
  } finally { app.close(); workspace.close(); }
});
test('完整候选限定17文件，旧浏览器存储/全局监听/DOM扫描不带入', () => {
  const preview = 构建Excel卡片候选(); assert.equal(preview.delta.size, 17);
  for (const [path, value] of preview.delta) if (value.原文 === null && /\.[jt]sx?$/.test(path)) {
    const source = ts.transpileModule(value.产物, { compilerOptions: { removeComments: true } }).outputText;
    assert.doesNotMatch(source, /localStorage|sessionStorage|MutationObserver|querySelector|window\.parent|addEventListener/);
  }
  const project = preview.delta.get('web/src/pages/canvas/project.tsx').产物;
  assert.match(project, /if \(!productActive \|\| !projectLoaded/);
  assert.match(project, /ExcelCanvasScope productId=\{projectId\}/);
});
