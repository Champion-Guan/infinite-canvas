import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import ts from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function load(name, dependencies = {}) {
    const file = resolve(root, '扩展功能', name), module = { exports: {} };
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const themes = await load('Excel画布/旧版主题翻译.js');
const variables = await load('提示词/变量使用规则.ts');
const rules = await load('Excel画布/旧版参数规则.ts', { './旧版主题翻译.js': themes, '../提示词/变量使用规则': variables });
const context = await load('Excel画布/Excel卡片上下文.ts', { './旧版参数规则': rules });
const titles = await load('Excel画布/旧版最终提示词标题.ts');
const parameterLinks = await load('Excel画布/产品参数联动.ts', { '../提示词/变量使用规则': variables, './旧版最终提示词标题': titles });
const excel = await load('Excel画布/Excel卡片事务.ts', { './旧版参数规则': rules, './产品参数联动': parameterLinks, './旧版最终提示词标题': titles, './Excel卡片上下文': context });
let serial = 0;
const api = await load('画布布局/节点复制操作.ts', {
    react: { useCallback: value => value, useRef: value => ({ current: value }) }, nanoid: { nanoid: () => 'new-' + ++serial },
    '@/types/canvas': { CanvasNodeType: { Group: 'group' } }, '../Excel画布/Excel卡片事务': excel,
});
const node = (id, metadata = {}, type = 'text', x = 0, y = 0) => ({ id, type, title: id, position: { x, y }, width: 100, height: 80, metadata });
const edge = (fromNodeId, toNodeId) => ({ id: fromNodeId + '-' + toNodeId, fromNodeId, toNodeId });
function copy(nodes, connections = [], current = nodes) {
    return api.prepareCopiedNodes(api.captureCopiedNodes(nodes, connections, new Set(nodes.map(item => item.id))), { x: 500, y: 600 }, current);
}

test('复制时冻结嵌套变量、批次及参考图快照，原卡后续编辑不污染剪贴内容', () => {
    const source = node('a', { promptVariableValues: { LENGTH: '' }, references: ['image:a'], images: [{ id: 'slot', content: 'blob:a', status: 'success' }] });
    const snapshot = api.captureCopiedNodes([source], [], new Set(['a']));
    source.metadata.promptVariableValues.LENGTH = '100'; source.metadata.references.push('image:b'); source.metadata.images[0].content = 'blob:new';
    const result = api.prepareCopiedNodes(snapshot, { x: 0, y: 0 }, [source]).nodes[0];
    assert.equal(result.metadata.promptVariableValues.LENGTH, '');
    assert.deepEqual(result.metadata.references, ['image:a']); assert.equal(result.metadata.images[0].content, 'blob:a');
    assert.equal(api.captureCopiedNodes([source], [], new Set(['missing'])), null);
});
test('整组选中粘贴后组、Excel来源、参数与预览全部指向本次新卡，保持相对布局', () => {
    const group = node('group', {}, 'group', -100, -100);
    const source = node('source', { groupId: 'group', excelPromptBindingNodeId: 'parameter', excelPromptResolved: '原文' }, 'text', 20, 30);
    const parameter = node('parameter', { groupId: 'group', promptVariableSourceNodeId: 'source', promptVariablePreviewNodeId: 'preview', promptVariableValues: { LENGTH: '' } }, rules.PROMPT_VARIABLES_NODE_TYPE, 200, 30);
    const preview = node('preview', { groupId: 'group', promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: 'source' }, 'text', 400, 30);
    const original = [group, source, parameter, preview], before = structuredClone(original);
    const result = copy(original, [edge('parameter', 'source'), edge('source', 'preview')]);
    const [g, s, p, v] = result.nodes;
    assert.equal(s.metadata.groupId, g.id); assert.equal(p.metadata.groupId, g.id); assert.equal(v.metadata.groupId, g.id);
    assert.equal(s.metadata.excelPromptBindingNodeId, p.id); assert.equal(p.metadata.promptVariableSourceNodeId, s.id);
    assert.equal(p.metadata.promptVariablePreviewNodeId, v.id); assert.equal(v.metadata.promptVariablePreviewOf, p.id);
    assert.equal(v.metadata.promptVariableSourceNodeId, s.id); assert.equal(p.metadata.promptVariableValues.LENGTH, '');
    assert.equal(s.position.x - g.position.x, 120); assert.equal(v.position.x - s.position.x, 380);
    assert.deepEqual(result.connections.map(e => [e.fromNodeId, e.toNodeId]), [[p.id, s.id], [s.id, v.id]]);
    assert.deepEqual(original, before);
});
test('仅粘贴参数卡不沿用原来源、预览及组，保留已填变量并清空绑定预览', () => {
    const parameter = node('parameter', { groupId: 'group', promptVariableSourceNodeId: 'source', promptVariablePreviewNodeId: 'preview', promptVariableRawPrompt: '[LENGTH]', promptVariableResolvedPrompt: '10', promptVariableValues: { LENGTH: '10', COUNT: '' } }, rules.PROMPT_VARIABLES_NODE_TYPE);
    const result = copy([parameter], [], [parameter, node('group'), node('source'), node('preview')]).nodes[0];
    for (const key of ['groupId', 'promptVariableSourceNodeId', 'promptVariablePreviewNodeId']) assert.equal(result.metadata[key], undefined, key);
    assert.equal(result.metadata.promptVariableRawPrompt, ''); assert.equal(result.metadata.promptVariableResolvedPrompt, '');
    assert.deepEqual(result.metadata.promptVariableValues, { LENGTH: '10', COUNT: '' });
});
test('保留同画布有效外部输入；复制后原输入删除则不生成悬空连线或绑定', () => {
    const source = node('source', { excelPromptBindingNodeId: 'parameter', excelPromptResolved: '10', generationParamsSourceNodeId: 'parameter' });
    const edges = [edge('parameter', 'source'), edge('missing', 'source'), edge('source', 'unselected')];
    const snapshot = api.captureCopiedNodes([source], edges, new Set(['source']));
    const current = [source, node('parameter')], result = api.prepareCopiedNodes(snapshot, { x: 0, y: 0 }, current);
    assert.equal(result.connections.length, 1); assert.equal(result.connections[0].fromNodeId, 'parameter');
    assert.equal(result.nodes[0].metadata.excelPromptBindingNodeId, 'parameter');
    const deleted = api.prepareCopiedNodes(snapshot, { x: 0, y: 0 }, []);
    assert.deepEqual(deleted.connections, []);
    for (const key of ['excelPromptBindingNodeId', 'excelPromptResolved', 'generationParamsSourceNodeId']) assert.equal(deleted.nodes[0].metadata[key], undefined);
});
test('副本保留原图、交付图和配置，但不接管原任务、回执、批次或未决状态', () => {
    const source = node('image', { content: 'blob:a', status: 'loading', errorDetails: '旧错误', model: '模型', quality: 'high',
        storageKey: 'image:delivery', originalStorageKey: 'image:original', originalWidth: 1600, deliveryWidth: 800,
        gatewayGenerationTasks: [{ taskId: 'task' }], gatewayGenerationReceipts: [{ taskId: 'task', responseHash: 'hash' }], gatewayThemeCalibrationInput: { taskId: 'old' },
        videoTaskId: 'video', videoTaskProvider: 'openai', generationStartedAt: 10, generationBatchId: 'batch',
        images: [{ id: 'a', status: 'success', content: 'blob:a', name: '主图-1' }, { id: 'b', status: 'loading', content: '', errorDetails: '旧错误' }] }, 'image');
    const before = structuredClone(source), result = copy([source]).nodes[0];
    for (const key of ['gatewayGenerationTasks', 'gatewayGenerationReceipts', 'gatewayThemeCalibrationInput', 'videoTaskId', 'videoTaskProvider', 'generationStartedAt', 'generationBatchId']) assert.equal(result.metadata[key], undefined, key);
    for (const key of ['content', 'model', 'quality', 'storageKey', 'originalStorageKey', 'originalWidth', 'deliveryWidth']) assert.equal(result.metadata[key], source.metadata[key], key);
    assert.equal(result.metadata.status, 'success'); assert.equal(result.metadata.errorDetails, undefined);
    assert.equal(result.metadata.images[0].name, '主图-1'); assert.equal(result.metadata.images[1].status, 'idle');
    assert.deepEqual(source, before);
});
test('未决视频与文本空槽复制后可编辑重试，不保留假运行状态', () => {
    const video = node('video', { status: 'error', errorDetails: '请先配置', videoTaskId: 'pending' }, 'video');
    const text = node('text', { status: 'loading', texts: [{ id: 'a', content: '', status: 'loading' }, { id: 'b', content: '已完成', status: 'loading' }] });
    const [v, t] = copy([video, text]).nodes;
    assert.equal(v.metadata.status, 'idle'); assert.equal(v.metadata.videoTaskId, undefined); assert.equal(v.metadata.errorDetails, undefined);
    assert.equal(t.metadata.status, 'idle'); assert.deepEqual(t.metadata.texts.map(i => i.status), ['idle', 'success']);
});
test('连续粘贴生成不同ID并各自深拷贝，位置居中且不累加Copy后缀', () => {
    const original = [node('a', { references: ['image:a'] }, 'text', 0, 0), node('b', {}, 'text', 200, 100)];
    original[0].title = '原卡 Copy';
    const snapshot = api.captureCopiedNodes(original, [edge('a', 'b')], new Set(['a', 'b']));
    const first = api.prepareCopiedNodes(snapshot, { x: 500, y: 600 }, original), second = api.prepareCopiedNodes(snapshot, { x: 500, y: 600 }, [...original, ...first.nodes]);
    assert.equal(new Set([...first.nodes, ...second.nodes].map(n => n.id)).size, 4);
    first.nodes[0].metadata.references.push('image:edit'); assert.deepEqual(second.nodes[0].metadata.references, ['image:a']);
    assert.equal(first.nodes[0].title, '原卡 Copy');
    assert.equal((first.nodes[0].position.x + first.nodes[1].position.x + 100) / 2, 500);
    assert.deepEqual(api.prepareCopiedNodes({ nodes: [], connections: [] }, { x: 0, y: 0 }, []), { nodes: [], connections: [] });
});
function hooked(nodes, connections = []) {
    const nodesRef = { current: nodes }, connectionsRef = { current: connections }, selectedNodeIdsRef = { current: new Set(nodes.map(n => n.id)) };
    const selection = [], dialogs = [], menus = []; let writes = 0;
    const operations = api.useCanvasNodeCopy({ nodesRef, connectionsRef, selectedNodeIdsRef, getCanvasCenter: () => ({ x: 500, y: 600 }),
        setNodes: update => { writes++; nodesRef.current = update(nodesRef.current); }, setConnections: value => { connectionsRef.current = value; },
        setSelectedNodeIds: value => selection.push([...value]), setSelectedConnectionId: () => {}, setContextMenu: value => menus.push(value), setDialogNodeId: value => dialogs.push(value) });
    return { ...operations, nodesRef, connectionsRef, selectedNodeIdsRef, selection, dialogs, menus, writes: () => writes };
}
test('单卡复制读取最新节点，保留有效输入与组；已删卡不改选择、历史或界面', () => {
    const source = node('source', { groupId: 'group', content: '原文', promptVariableValues: { LENGTH: '' } }), group = node('group', {}, 'group');
    const h = hooked([source, group], [edge('group', 'source')]);
    h.duplicateNode('missing'); assert.equal(h.writes(), 0); assert.deepEqual(h.dialogs, []);
    h.duplicateNode('source'); const copied = h.nodesRef.current[2];
    assert.equal(copied.metadata.groupId, 'group'); assert.deepEqual(copied.position, { x: 36, y: 36 });
    assert.equal(h.connectionsRef.current[1].toNodeId, copied.id); assert.deepEqual(h.selection, [[copied.id]]);
    copied.metadata.promptVariableValues.LENGTH = '20'; assert.equal(source.metadata.promptVariableValues.LENGTH, '');
    h.duplicateNode('group'); assert.equal(h.dialogs.at(-1), null); assert.equal(h.menus.length, 0);
});
test('空剪贴返回false，连续复制粘贴通过原引用追加并关闭菜单', () => {
    const h = hooked([node('a'), node('b')], [edge('a', 'b')]);
    assert.equal(h.pasteCopiedNodes(), false); assert.equal(h.writes(), 0);
    h.copySelectedNodes(); assert.equal(h.pasteCopiedNodes(), true); assert.equal(h.pasteCopiedNodes(), true);
    assert.equal(h.nodesRef.current.length, 6); assert.equal(h.connectionsRef.current.length, 3); assert.equal(h.writes(), 2);
    assert.deepEqual(h.menus, [null, null]); assert.equal(h.selection.at(-1).length, 2);
});
test('复制操作Hook顺序及依赖完整', () => {
    const file = resolve(root, '扩展功能/画布布局/节点复制操作.ts');
    const messages = new Linter().verify(readFileSync(file, 'utf8'), [{ files: ['**/*.ts'], languageOptions: { parser: ts.parser },
        plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' } }], { filename: file });
    assert.deepEqual(messages, []);
});

test('卡片挂载保留复制/撤销快照及明确空值，记忆只补缺失键且不被旧卡倒灌', async () => {
    const saved = new Map(), writes = [];
    const memory = await load('Excel画布/Excel参数记忆.ts', {
        '../本机存储/上游浏览器存储桥': { sqlitePreferences: {
            getItem: key => saved.get(key) ?? null,
            setItem: (key, value) => { writes.push(value); saved.set(key, value); },
        } },
    });
    memory.saveProductParameterValues('product', { LENGTH: '100', COUNT: '7', MATERIAL: '棉' }); writes.length = 0;
    const current = { LENGTH: '', COUNT: '2', COLOR: '蓝' }, result = memory.restoreProductParameterValues('product', current);
    assert.deepEqual(result, { LENGTH: '', COUNT: '2', MATERIAL: '棉', COLOR: '蓝' });
    assert.deepEqual(current, { LENGTH: '', COUNT: '2', COLOR: '蓝' });
    assert.deepEqual(memory.readProductParameterValues('product'), { LENGTH: '100', COUNT: '7', MATERIAL: '棉', COLOR: '蓝' });
    assert.equal(writes.length, 1);
    memory.restoreProductParameterValues('product', current); assert.equal(writes.length, 1);
    assert.deepEqual(memory.restoreProductParameterValues('product', {}), memory.readProductParameterValues('product'));
    memory.saveProductParameterValues('product', { LENGTH: '' });
    assert.equal(memory.restoreProductParameterValues('product', {}).LENGTH, '');
    const before = writes.length;
    for (let index = 0; index < 200; index++) memory.saveProductParameterValues('product', { LENGTH: '' });
    assert.equal(writes.length, before, '未改变的参数不能重复进入保存队列');
    memory.saveProductParameterValues('product', { LENGTH: '0' });
    assert.equal(writes.length, before + 1);
    assert.equal(memory.readProductParameterValues('product').LENGTH, '0');
});
