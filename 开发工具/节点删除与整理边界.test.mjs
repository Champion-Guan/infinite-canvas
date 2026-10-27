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
    const file = resolve(root, '扩展功能', name);
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const hooks = { useCallback: callback => callback };
const themes = await load('Excel画布/旧版主题翻译.js');
const variables = await load('提示词/变量使用规则.ts');
const rules = await load('Excel画布/旧版参数规则.ts', { './旧版主题翻译.js': themes, '../提示词/变量使用规则': variables });
const context = await load('Excel画布/Excel卡片上下文.ts', { './旧版参数规则': rules });
const titles = await load('Excel画布/旧版最终提示词标题.ts');
const parameterLinks = await load('Excel画布/产品参数联动.ts', { '../提示词/变量使用规则': variables, './旧版最终提示词标题': titles });
const excel = await load('Excel画布/Excel卡片事务.ts', { './旧版参数规则': rules, './产品参数联动': parameterLinks, './旧版最终提示词标题': titles, './Excel卡片上下文': context });
let serial = 0;
const recycle = await load('画布回收/画布节点回收.ts', { nanoid: { nanoid: () => 'batch-' + ++serial }, '../Excel画布/Excel卡片事务': excel });
const layout = await load('画布布局/卡片自动避让.ts');
const outputRows = await load('画布布局/配置结果横排.ts', { './卡片自动避让': layout });
const geometry = await load(resolve(root, '.运行/3100源/画布副本/web/src/lib/canvas/canvas-node-geometry.ts'), {
    '@/types/canvas': { CanvasNodeType: { Group: 'group' } },
});
const node = (id, metadata = {}, x = 0, y = 0) => ({ id, type: 'text', title: id, position: { x, y }, width: 100, height: 80, metadata });
const state = value => ({ value, calls: 0, set(update) { this.value = typeof update === 'function' ? update(this.value) : update; this.calls++; } });

async function deletion(nodes, options = {}) {
    const nodesRef = { current: nodes }, connectionsRef = { current: options.connections || [] }, writes = [], cleanups = [];
    const ui = { selected: state(new Set(nodes.map(item => item.id))), selectedEdge: state('edge'), image: state('image-slot'),
        expanded: state(new Set(nodes.map(item => item.id))), menu: state(options.menu || { type: 'node', nodeId: nodes[0]?.id }) };
    const ids = (options.uiIds || [nodes[0]?.id || null, 'unrelated', null]).map(state);
    const port = { projectId: 'product', nodesRef, connectionsRef, chatSessions: [{ id: 'chat' }],
        updateProject: (id, patch) => writes.push({ id, patch }), setNodes: value => { nodesRef.current = value; },
        setConnections: value => { connectionsRef.current = value; }, nodeIdSetters: ids.map(item => item.set.bind(item)),
        setSelectedNodeIds: ui.selected.set.bind(ui.selected), setSelectedConnectionId: ui.selectedEdge.set.bind(ui.selectedEdge),
        setPreviewImageId: ui.image.set.bind(ui.image), setExpandedBatchNodeIds: ui.expanded.set.bind(ui.expanded),
        setContextMenu: ui.menu.set.bind(ui.menu), cleanupCanvasFiles: value => cleanups.push(value) };
    const { useCanvasNodeDeletion } = await load('画布回收/节点删除操作.ts', {
        react: hooks, './画布节点回收': recycle,
        '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => ({ openProject: id => {
            assert.equal(id, 'product'); return options.missing ? null : { deletedNodeBatches: options.batches || [] };
        } }) } },
    });
    return { run: useCanvasNodeDeletion(port), port, ui, ids, writes, cleanups };
}

test('空选择、已删除节点或不存在的画布不写回收记录、不清理界面和素材', async () => {
    for (const options of [{ ids: new Set() }, { ids: new Set(['missing']) }, { ids: new Set(['a']), missing: true }]) {
        const api = await deletion([node('a')], options); api.run(options.ids);
        assert.deepEqual(api.writes, []); assert.deepEqual(api.cleanups, []);
        assert.ok(Object.values(api.ui).every(value => value.calls === 0));
    }
});
test('删除Excel来源同步回收预览、清除关联与连线，保留原批次素材及未删除节点界面', async () => {
    const source = node('source', { excelPromptBindingNodeId: 'parameter', excelPromptResolved: '提示词' });
    const preview = node('preview', { promptVariablePreviewOf: 'parameter', promptVariableSourceNodeId: 'source' });
    const parameter = node('parameter', { promptVariableSourceNodeId: 'source', promptVariablePreviewNodeId: 'preview', promptVariableRawPrompt: '[LENGTH]' });
    const old = [source, preview, parameter], connections = [{ id: 'edge', fromNodeId: 'source', toNodeId: 'parameter' }];
    const api = await deletion(old, { connections, uiIds: ['source', 'preview', 'parameter', null] });
    api.run(new Set(['source']));
    assert.deepEqual(api.port.nodesRef.current.map(item => item.id), ['parameter']);
    assert.equal(api.port.nodesRef.current[0].metadata.promptVariableSourceNodeId, undefined);
    assert.equal(api.port.nodesRef.current[0].metadata.promptVariableRawPrompt, '');
    assert.deepEqual(api.port.connectionsRef.current, []);
    const batch = api.writes[0].patch.deletedNodeBatches[0];
    assert.deepEqual(batch.nodes, [source, preview]); assert.deepEqual(batch.connections, connections);
    assert.deepEqual(batch.relatedNodes, [parameter]);
    assert.deepEqual(api.ids.map(item => item.value), [null, null, 'parameter', null]);
    assert.equal(api.ui.menu.value, null); assert.equal(api.ui.image.value, null);
    assert.equal(api.ui.selected.value.size, 0); assert.equal(api.ui.selectedEdge.value, null);
    assert.deepEqual([...api.ui.expanded.value], ['parameter']);
    assert.equal(api.cleanups[0].projectId, 'product'); assert.deepEqual(api.cleanups[0].chatSessions, api.port.chatSessions);
    assert.deepEqual(api.cleanups[0].nodes, api.port.nodesRef.current);
    assert.equal(old.length, 3); assert.equal(parameter.metadata.promptVariableSourceNodeId, 'source');
    const restored = recycle.restoreCanvasNodes(api.port.nodesRef.current, [], batch);
    assert.equal(restored.nodes.length, 3); assert.deepEqual(restored.connections, connections);
    assert.equal(restored.nodes.find(item => item.id === 'parameter').metadata.promptVariableSourceNodeId, 'source');
});
test('删除组保留子卡并解绑，其他右键菜单和未删除节点的打开状态不被清空', async () => {
    const group = { ...node('group'), type: 'group' }, child = node('child', { groupId: 'group' });
    const menu = { type: 'connection', connectionId: 'other-edge' };
    const api = await deletion([group, child], { menu, uiIds: ['child', null] }); api.run(new Set(['group']));
    assert.deepEqual(api.port.nodesRef.current.map(item => item.id), ['child']);
    assert.equal(api.port.nodesRef.current[0].metadata.groupId, undefined);
    assert.deepEqual(api.ids.map(item => item.value), ['child', null]); assert.equal(api.ui.menu.value, menu);
    assert.equal(child.metadata.groupId, 'group');
});
test('再次删除已恢复的节点只更新对应批次，其他回收节点和原数组保留', async () => {
    const a = node('a'), b = node('b'), old = { id: 'old', nodes: [a, b], connections: [] };
    const api = await deletion([a], { batches: [old] }); api.run(new Set(['a']));
    const batches = api.writes[0].patch.deletedNodeBatches;
    assert.deepEqual(batches.map(item => item.nodes.map(value => value.id)), [['b'], ['a']]);
    assert.deepEqual(old.nodes, [a, b]);
});

const serviceRoot = resolve(root, '.运行/3100源/画布副本/web/src');
const servicePorts = {
    '@/扩展功能/素材/上传资产规则': await load('素材/上传资产规则.ts'),
    '@/扩展功能/媒体交付/生成图片尺寸交付.mjs': {}, '@/扩展功能/媒体交付/图片上传预检.mjs': {},
    '@/扩展功能/媒体交付/HEIC上传兼容.mjs': {},
    "@/扩展功能/媒体交付/媒体地址缓存": await load("媒体交付/媒体地址缓存.ts"),
    '@/扩展功能/网络代理/本地转发请求': { 本地转发请求: globalThis.fetch, 本地转发Axios: {} },
    '@/扩展功能/本机存储/上游浏览器存储桥': { sqliteForage: { createInstance: () => ({}) } },
    nanoid: { nanoid: () => 'unused' }, '@/扩展功能/画布迁移扩展/内嵌图片解码.mjs': {},
    '@/扩展功能/安全与批量/persistence-checkpoint': { createPersistenceCheckpoint: () => ({}) },
    '@/扩展功能/安全与批量/settle-activity-group': {}, '@/i18n': {}, '@/stores/use-config-store': {}, '@/lib/image-thumbnail': {},
};
const imageService = await load(resolve(serviceRoot, 'services/image-storage.ts'), servicePorts);
const mediaService = await load(resolve(serviceRoot, 'services/file-storage.ts'), servicePorts);
const helpers = await load(resolve(serviceRoot, 'lib/canvas/canvas-generation-helpers.ts'), {
    '@/stores/use-config-store': {}, '@/i18n': { default: { t: key => key }, __esModule: true },
    '@/types/canvas': { CanvasNodeType: { Text: 'text', Image: 'image', Video: 'video', Audio: 'audio' } },
    '@/services/image-storage': { resolveImageUrl: async key => 'local:' + key, ensureImagePreview: () => {} },
    '@/services/file-storage': { resolveMediaUrl: async key => 'local:' + key }, '@/lib/canvas/canvas-node-factory': {},
});
async function restore(nodes, missing = null) {
    const batch = { id: 'batch', nodes, connections: [] }, writes = [], applied = [], errors = [], reads = [], resumed = [];
    let saves = 0;
    const { useCanvasNodeRecycle } = await load('画布回收/节点回收操作.ts', {
        react: { ...hooks, useRef: value => ({ current: value }) },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => ({ openProject: () => ({ deletedNodeBatches: [batch] }) }) } },
        '@/services/image-storage': { collectImageStorageKeys: imageService.collectImageStorageKeys,
            getImageBlob: async key => { reads.push(['image', key]); return key === missing ? null : new Blob(['image']); } },
        '@/services/file-storage': { collectMediaStorageKeys: mediaService.collectMediaStorageKeys,
            getMediaBlob: async key => { reads.push(['media', key]); return key === missing || key.startsWith('image:') ? null : new Blob(['media']); } },
        '@/lib/canvas/canvas-generation-helpers': helpers, './画布节点回收': recycle,
        '../安全与批量/update-activity': { observeActivity: async (_kind, action) => action() },
        '../安全与批量/settle-activity-group': { settleActivityGroup: values => Promise.all(values) },
        '../产品/产品操作': { saveProductCanvas: async () => { saves++; } },
    });
    const api = useCanvasNodeRecycle({ projectId: 'product', nodesRef: { current: [] }, historyRef: { current: { past: [], future: [] } },
        lastHistoryRef: { current: null }, createHistoryEntry: () => ({ nodes: [], connections: [] }), applyHistory: value => applied.push(value),
        assertImportTarget: () => {}, updateProject: (_id, patch) => writes.push(patch), setSelectedNodeIds: () => {},
        pollVideoNodeTask: value => resumed.push(value.id), message: { error: value => errors.push(value), success: () => {} } });
    await api.restoreDeletedNodeBatch('batch');
    return { batch, writes, applied, errors, reads, resumed, saves };
}
test('真实Set收集器和真实水合规则可恢复纯文本批次，不访问素材或模型', async () => {
    const item = node('text'), result = await restore([item]);
    assert.deepEqual(result.errors, []); assert.equal(result.saves, 1); assert.deepEqual(result.reads, []);
    assert.equal(result.applied[0].nodes[0], item); assert.deepEqual(result.writes[0].deletedNodeBatches, []);
});
test('图片原图、交付图和批次素材分别校验，不把图片键送入音视频存储', async () => {
    const image = { ...node('image', { content: 'local:image:delivery', storageKey: 'image:delivery', originalStorageKey: 'image:original',
        images: [{ id: 'slot', storageKey: 'image:slot', content: 'local:image:slot' }] }), type: 'image' };
    const result = await restore([image]); assert.deepEqual(result.errors, []); assert.equal(result.saves, 1);
    assert.deepEqual(result.reads, [['image', 'image:delivery'], ['image', 'image:original'], ['image', 'image:slot']]);
    assert.equal(result.applied[0].nodes[0].metadata.content, 'local:image:delivery');
    const missing = await restore([image], 'image:original');
    assert.match(missing.errors[0], /图片素材缺失/); assert.equal(missing.writes.length, 0); assert.equal(missing.saves, 0);
});
test('真实音视频素材缺失时保留回收批次，有素材时恢复URL且不重新发生成请求', async () => {
    const audio = { ...node('audio', { storageKey: 'audio:one', content: 'old' }), type: 'audio' };
    const video = { ...node('video', { storageKey: 'video:one', content: 'old' }), type: 'video' };
    const result = await restore([audio, video]); assert.deepEqual(result.errors, []); assert.equal(result.saves, 1);
    assert.deepEqual(result.reads, [['media', 'audio:one'], ['media', 'video:one']]); assert.deepEqual(result.resumed, []);
    assert.deepEqual(result.applied[0].nodes.map(item => item.metadata.content), ['local:audio:one', 'local:video:one']);
    const missing = await restore([audio, video], 'video:one');
    assert.match(missing.errors[0], /音视频素材缺失/); assert.deepEqual(missing.writes, []); assert.equal(missing.batch.nodes.length, 2);
});

async function arrangement(nodes, size = { width: 1200, height: 720 }, connections = [{ id: 'edge' }]) {
    const snapshot = { nodes, connections, chatSessions: [{ id: 'chat' }] };
    const historyRef = { current: { past: Array.from({ length: 55 }, (_, index) => ({ id: index })), future: [{ id: 'redo' }] } };
    const applied = [], viewports = [], messages = [];
    const { useCanvasNodeArrangement } = await load('画布布局/重叠卡片整理操作.ts', {
        react: hooks, './卡片自动避让': layout, './配置结果横排': outputRows, '@/types/canvas': { CanvasNodeType: { Group: 'group' } },
        '@/lib/canvas/canvas-node-geometry': geometry,
    });
    const run = useCanvasNodeArrangement({ historyRef, createHistoryEntry: () => snapshot, applyHistory: value => applied.push(value),
        message: { info: value => messages.push(value), success: value => messages.push(value) }, size, setViewport: value => viewports.push(value) });
    return { run, snapshot, historyRef, applied, viewports, messages };
}
test('无重叠时不产生撤销记录、不改变视区和既有重做记录', async () => {
    const api = await arrangement([node('a'), node('b', {}, 500, 500)]), before = api.historyRef.current;
    api.run(); assert.equal(api.historyRef.current, before); assert.equal(before.past.length, 55); assert.equal(before.future.length, 1);
    assert.deepEqual(api.applied, []); assert.deepEqual(api.viewports, []); assert.match(api.messages[0], /没有需要整理/);
});
test('重叠整理只移动后来的卡片、共用原历史并保留连接和会话，拟合视区有边界', async () => {
    for (const size of [{ width: 1200, height: 720 }, { width: 10, height: 10 }]) {
        const first = node('a'), second = node('b'), far = node('far', {}, 10000, 10000);
        const api = await arrangement([first, second, far], size); api.run();
        const result = api.applied[0]; assert.equal(result.nodes[0], first); assert.equal(result.nodes[2], far);
        assert.equal(layout.nodesOverlap(result.nodes[0], result.nodes[1]), false);
        assert.equal(result.connections, api.snapshot.connections); assert.equal(result.chatSessions, api.snapshot.chatSessions);
        assert.equal(api.historyRef.current.past.length, 50); assert.equal(api.historyRef.current.past.at(-1), api.snapshot);
        assert.deepEqual(api.historyRef.current.future, []); assert.deepEqual(second.position, { x: 0, y: 0 });
        const view = api.viewports[0]; assert.ok(Object.values(view).every(Number.isFinite)); assert.ok(view.k >= 0.05 && view.k <= 1);
        assert.match(api.messages[0], /已整理 1 张/);
    }
});
test('整理扩展组容器以容纳移动后的子卡，异常尺寸不参与碰撞和缩放', async () => {
    const group = { ...node('group'), type: 'group' }, a = node('a', { groupId: 'group' }), b = node('b', { groupId: 'group' });
    const bad = { ...node('bad'), width: NaN }, api = await arrangement([group, a, b, bad]); api.run();
    const result = api.applied[0].nodes, moved = result.find(item => item.id === 'b'), wrap = result.find(item => item.id === 'group');
    assert.ok(wrap.position.y + wrap.height >= moved.position.y + moved.height);
    assert.equal(result.find(item => item.id === 'bad'), bad); assert.ok(Object.values(api.viewports[0]).every(Number.isFinite));
});
test('无重叠的单线错位通过真实整理入口一次写入历史，保留原连接和内容', async () => {
    const source = node('source'), target = node('target', { content: '保留原内容' }, 700, 5);
    const connections = [{ id: 'single', fromNodeId: source.id, toNodeId: target.id }];
    const api = await arrangement([source, target], undefined, connections); api.run();
    assert.equal(api.applied.length, 1);
    assert.deepEqual(api.applied[0].nodes[1].position, { x: 148, y: 0 });
    assert.equal(api.applied[0].nodes[1].metadata, target.metadata);
    assert.equal(api.applied[0].connections, connections);
    assert.equal(api.historyRef.current.past.at(-1), api.snapshot);
    assert.deepEqual(api.snapshot.nodes[1].position, { x: 700, y: 5 });
    assert.match(api.messages[0], /已整理 1 张/);
});
test('整理卡片将普通单线排成来源在左、目标在右的同高水平关系', () => {
    const a = node('a', {}, 0, 0), b = node('b', {}, 700, 220);
    const arranged = layout.arrangeOverlappingCanvasNodes([a, b], [{ id: 'ab', fromNodeId: 'a', toNodeId: 'b' }]);
    assert.deepEqual(arranged[0].position, a.position);
    assert.deepEqual(arranged[1].position, { x: 148, y: 0 });
    const reverse = layout.arrangeOverlappingCanvasNodes([a, b], [{ id: 'ba', fromNodeId: 'b', toNodeId: 'a' }]);
    assert.deepEqual(reverse.find(item => item.id === 'b').position, { x: 700, y: 220 });
    assert.deepEqual(reverse.find(item => item.id === 'a').position, { x: 848, y: 220 });
    const widelySpaced = layout.arrangeOverlappingCanvasNodes([node('left', {}, 0, 0), node('right', {}, 900, 0)],
        [{ id: 'wide', fromNodeId: 'left', toNodeId: 'right' }]);
    assert.deepEqual(widelySpaced[1].position, { x: 900, y: 0 });
});
test('分支与汇入节点及其关联端点全部保持原位', () => {
    const source = node('source', {}, 0, 0), other = node('other', {}, 0, 500);
    const junction = node('junction', {}, 700, 400), branch = node('branch', {}, 1100, 0), merge = node('merge', {}, 1100, 500);
    const nodes = [source, other, junction, branch, merge];
    const connections = [
        { id: 'in1', fromNodeId: 'source', toNodeId: 'junction' },
        { id: 'in2', fromNodeId: 'other', toNodeId: 'junction' },
        { id: 'out1', fromNodeId: 'junction', toNodeId: 'branch' },
        { id: 'out2', fromNodeId: 'junction', toNodeId: 'merge' },
    ];
    const ordinaryOverlap = node('ordinary-overlap', {}, 0, 0);
    const arranged = layout.arrangeOverlappingCanvasNodes([...nodes, ordinaryOverlap], connections);
    for (const item of nodes) assert.deepEqual(arranged.find(value => value.id === item.id).position, item.position);
    assert.notDeepEqual(arranged.find(value => value.id === ordinaryOverlap.id).position, ordinaryOverlap.position);
    const overlapBeforeJunction = node('overlap-before-junction', {}, 700, 400);
    const ordered = layout.arrangeOverlappingCanvasNodes([overlapBeforeJunction, ...nodes], connections);
    assert.deepEqual(ordered.find(item => item.id === 'junction').position, junction.position);
    assert.notDeepEqual(ordered.find(item => item.id === overlapBeforeJunction.id).position, overlapBeforeJunction.position);
});
const imageOutput = (id, title, x, y, width = 100, height = 140) => ({ ...node(id, { content: '原图:' + id }, x, y), type: 'image', title, width, height });
const resultConfig = (id, x = 0, y = 0) => ({ ...node(id, { generationMode: 'image' }, x, y), type: 'config', width: 340, height: 240 });
const outputEdges = (source, outputs) => outputs.map(target => ({ id: '旧数据重复ID', fromNodeId: source.id, toNodeId: target.id }));
test('同配置多图按名称自然排序横排，端点精确同高、间距一致且不修改原数据和连线', async () => {
    const config = resultConfig('config', 20, 100);
    const images = [imageOutput('ten', '详情页09-10', 900, 10), imageOutput('two', '详情页09-2', 600, 500, 130, 180),
        imageOutput('one', '详情页09-1', 450, 200, 110, 150), imageOutput('eleven', '详情页09-11', 1400, 300)];
    const nodes = [config, ...images], original = structuredClone(nodes), connections = outputEdges(config, images);
    const api = await arrangement(nodes, undefined, connections); api.run();
    assert.equal(api.applied.length, 1);
    const arranged = api.applied[0].nodes, row = arranged.filter(item => item.type === 'image').sort((a, b) => a.position.x - b.position.x);
    assert.deepEqual(row.map(item => item.title), ['详情页09-1', '详情页09-2', '详情页09-10', '详情页09-11']);
    assert.equal(row[0].position.x, 20 + 340 + 96);
    for (const [index, item] of row.entries()) {
        assert.equal(item.position.y + item.height / 2, 220);
        if (index) assert.equal(item.position.x - row[index - 1].position.x - row[index - 1].width, 48);
        const old = images.find(value => value.id === item.id);
        assert.equal(item.metadata, old.metadata); assert.equal(item.title, old.title); assert.equal(item.width, old.width); assert.equal(item.height, old.height);
    }
    assert.equal(arranged[0], config); assert.deepEqual(nodes, original);
    assert.equal(api.applied[0].connections, connections); assert.equal(api.historyRef.current.past.at(-1), api.snapshot);
    assert.equal(api.applied[0].chatSessions, api.snapshot.chatSessions);
    assert.equal(outputRows.arrangeConfigResultRows(arranged, connections), arranged, '重复整理必须无变化');
    const again = await arrangement(arranged, undefined, connections); again.run();
    assert.equal(again.applied.length, 0); assert.equal(again.historyRef.current.future.length, 1);
});
test('横排行只根据真实配置归属，同名无连线图片、汇入和有后续分支的结果不强行改排', () => {
    const config = resultConfig('a'), other = resultConfig('b', 0, 600);
    const first = imageOutput('first', '详情页09-1', 450, 500), second = imageOutput('second', '详情页09-2', 700, 300);
    const unrelated = imageOutput('unrelated', '详情页09-3', 1100, 900);
    const nodes = [config, other, first, second, unrelated], edges = outputEdges(config, [first, second]);
    const normal = outputRows.arrangeConfigResultRows(nodes, edges);
    assert.equal(normal.find(item => item.id === unrelated.id), unrelated);
    assert.equal(outputRows.arrangeConfigResultRows(nodes, [...edges, { id: 'merge', fromNodeId: other.id, toNodeId: second.id }]), nodes);
    assert.equal(outputRows.arrangeConfigResultRows(nodes, [...edges, { id: 'downstream', fromNodeId: first.id, toNodeId: unrelated.id }]), nodes);
    const single = [config, first];
    assert.equal(outputRows.arrangeConfigResultRows(single, edges.slice(0, 1)), single);
});
test('横排遇到其他卡片时整行向右让位，不能拆散行或把单张推下去，分组背景不阻挡', () => {
    const config = resultConfig('config'), a = imageOutput('a', '详情页09-2', 450, 500), b = imageOutput('b', '详情页09-1', 800, 350);
    const blocker = { ...node('blocker', {}, 500, 0), width: 120, height: 240 };
    const group = { ...node('background', {}, -200, -200), type: 'group', width: 3000, height: 3000 };
    const nodes = [config, a, b, blocker, group], edges = outputEdges(config, [a, b]);
    const arranged = outputRows.arrangeConfigResultRows(nodes, edges), row = [b, a].map(old => arranged.find(item => item.id === old.id));
    assert.equal(row[0].position.x, 620 + 48); assert.equal(row[1].position.x, row[0].position.x + row[0].width + 48);
    for (const item of row) { assert.equal(item.position.y + item.height / 2, 120); assert.equal(layout.nodesOverlap(item, blocker, 48), false); }
    assert.equal(arranged.find(item => item.id === blocker.id), blocker); assert.equal(arranged.find(item => item.id === group.id), group);
});
test('多配置同时规划只参考最终行位置，不把其他行的旧结果当作障碍；同名结果不串组', () => {
    const top = resultConfig('top'), bottom = resultConfig('bottom', 0, 500);
    const a = imageOutput('a', '详情页09-2', 700, 800), b = imageOutput('b', '详情页09-1', 900, 900);
    const c = imageOutput('c', '详情页09-2', 450, 80), d = imageOutput('d', '详情页09-1', 600, 80);
    const nodes = [bottom, c, d, top, a, b], edges = [...outputEdges(bottom, [c, d]), ...outputEdges(top, [a, b])];
    const arranged = outputRows.arrangeConfigResultRows(nodes, edges);
    for (const [config, outputs] of [[top, [b, a]], [bottom, [d, c]]]) for (const [index, old] of outputs.entries()) {
        const item = arranged.find(value => value.id === old.id);
        assert.equal(item.position.x, 436 + index * 148); assert.equal(item.position.y + item.height / 2, config.position.y + 120);
    }
    assert.equal(outputRows.arrangeConfigResultRows(arranged, edges), arranged);
});
test('横排后扩展已有分组包围盒，异常尺寸不参与排布，重复关系不会重复摆一张图', () => {
    const config = resultConfig('config'), a = imageOutput('a', '09-1', 450, 700), b = imageOutput('b', '09-2', 500, 900);
    a.metadata.groupId = 'group'; b.metadata.groupId = 'group';
    const group = { ...node('group', {}, 0, 500), type: 'group', width: 200, height: 100 };
    const nodes = [group, config, a, b], edges = [...outputEdges(config, [a, b]), ...outputEdges(config, [a])];
    const arranged = outputRows.arrangeConfigResultRows(nodes, edges), wrap = arranged[0];
    for (const item of arranged.filter(item => item.type === 'image')) {
        assert.ok(wrap.position.x <= item.position.x && wrap.position.y <= item.position.y);
        assert.ok(wrap.position.x + wrap.width >= item.position.x + item.width);
        assert.ok(wrap.position.y + wrap.height >= item.position.y + item.height);
    }
    const invalid = [config, a, { ...b, height: NaN }];
    assert.equal(outputRows.arrangeConfigResultRows(invalid, edges), invalid);
});
test('单线整理遇到候选位置障碍时跳过所有相关移动', () => {
    const a = node('a', {}, 0, 0), b = node('b', {}, 700, 220);
    const blockers = [node('blocker-target', {}, 148, 0), node('blocker-source', {}, 552, 220)];
    const nodes = [a, b, ...blockers];
    const arranged = layout.arrangeOverlappingCanvasNodes(nodes, [{ id: 'ab', fromNodeId: 'a', toNodeId: 'b' }]);
    assert.equal(arranged, nodes);
});
test('操作Hook依赖完整，删除清理全部界面入口，生成状态继续由请求表管理', () => {
    const linter = new Linter();
    for (const name of ['画布回收/节点删除操作.ts', '画布布局/重叠卡片整理操作.ts', '画布生成/生成连线保护.ts']) {
        const file = resolve(root, '扩展功能', name);
        const messages = linter.verify(readFileSync(file, 'utf8'), [{ files: ['**/*.ts'], languageOptions: { parser: ts.parser },
            plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' } }], { filename: file });
        assert.deepEqual(messages, [], name);
    }
    const source = readFileSync(resolve(root, '.运行/3100源/画布副本/web/src/pages/canvas/project.tsx'), 'utf8');
    const setters = source.match(/const deletedNodeIdSetters = useMemo\(\(\) => \[([\s\S]+?)\], \[\]\)/)?.[1].match(/set\w+/g);
    assert.deepEqual(setters, ['setHoveredNodeId', 'setToolbarNodeId', 'setDialogNodeId', 'setInfoNodeId', 'setCropNodeId', 'setMaskEditNodeId',
        'setAngleNodeId', 'setPreviewNodeId', 'setSplitNodeId', 'setUpscaleNodeId', 'setReferencePickerNodeId']);
    assert.ok(source.includes('useCanvasGenerationRequests()'), '运行状态不能退回单个全局节点ID');
});
