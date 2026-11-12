import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../.运行/3100源/画布副本/web');
const nativeRequire = createRequire(resolve(root, 'package.json'));
const modules = new Map();
async function load(path) {
    const file = [path, `${path}.ts`, `${path}.tsx`, `${path}.js`].find(existsSync);
    assert.ok(file, `模块不存在：${path}`);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: extname(file) === '.js' ? 'js' : 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const imports = new Map();
    for (const [, quoted] of code.matchAll(/require\(("(?:\\.|[^"\\])*")\)/g)) {
        const id = JSON.parse(quoted);
        if (id.startsWith('@/') || id.startsWith('.')) imports.set(id, await load(id.startsWith('@/') ? resolve(root, 'src', id.slice(2)) : resolve(dirname(file), id)));
    }
    new Function('require', 'module', 'exports', code)(id => imports.has(id) ? imports.get(id) : nativeRequire(id), module, module.exports);
    return module.exports;
}
const { prepareCanvasContentImport: prepare } = await load(resolve(root, 'src/扩展功能/画布导入/画布内容导入.ts'));
const { recycleCanvasNodes: recycle, restoreCanvasNodes: restore, withoutDeletedNodes: prune } = await load(resolve(root, 'src/扩展功能/画布回收/画布节点回收.ts'));
const node = (id, metadata = {}, type = 'text') => ({ id, type, title: id, position: { x: 10, y: 20 }, width: 100, height: 80, metadata });
const edge = (id, fromNodeId, toNodeId) => ({ id, fromNodeId, toNodeId });
const document = (nodes, connections = [], files = []) => ({ app: 'infinite-canvas', version: 3, projects: [{ project: { nodes, connections }, files }] });
const mediaFile = (storageKey, path = 'image.png') => ({ storageKey, path, bytes: 3, mimeType: 'image/png' });

test('追加导入保留既有节点，并重映射分组、Excel关系与连线', () => {
    const existing = [node('existing')], before = JSON.stringify(existing);
    const source = [node('group', {}, 'group'), node('prompt', { groupId: 'group', excelPromptBindingNodeId: 'params' }), node('params', { promptVariableSourceNodeId: 'prompt' }, 'guan:prompt-variables')];
    const result = prepare(document(source, [edge('e', 'prompt', 'params')]), new Map(), existing);
    assert.equal(JSON.stringify(existing), before);
    assert.equal(result.nodes.length, 3);
    assert.equal(result.nodes[1].metadata.groupId, result.nodes[0].id);
    assert.equal(result.nodes[1].metadata.excelPromptBindingNodeId, result.nodes[2].id);
    assert.equal(result.connections[0].fromNodeId, result.nodes[1].id);
    assert.ok(result.nodes.every(n => n.position.x >= existing[0].position.x + existing[0].width + 80));
});

test('原图、交付图、图片列表及参考key独立复制，多次导入不共用key', () => {
    const keys = ['image:main', 'image:original', 'image:delivery'];
    const data = document([node('image', { storageKey: keys[0], originalStorageKey: keys[1], deliveryStorageKey: keys[2], images: [{ id: 'i', storageKey: keys[0] }], references: keys }, 'image')], [], keys.map((key, i) => mediaFile(key, `${i}.png`)));
    const zip = new Map(keys.map((_, i) => [`${i}.png`, new Blob(['abc'])]));
    const a = prepare(data, zip, []), b = prepare(data, zip, []), metadata = a.nodes[0].metadata;
    assert.equal(a.media.length, 3);
    assert.equal(metadata.storageKey, metadata.images[0].storageKey);
    assert.deepEqual(metadata.references, [metadata.storageKey, metadata.originalStorageKey, metadata.deliveryStorageKey]);
    assert.ok(a.media.every(item => !keys.includes(item.key) && !b.media.some(other => other.key === item.key)));
    assert.equal(data.projects[0].project.nodes[0].metadata.storageKey, keys[0]);
});

test('缺失媒体和不匹配的大小在准备阶段拒绝', () => {
    const data = document([node('a', { storageKey: 'image:a' })], [], [mediaFile('image:a')]);
    assert.throws(() => prepare(data, new Map(), []));
    assert.throws(() => prepare(data, new Map([['image.png', new Blob(['too-long'])]]), []));
    assert.throws(() => prepare(document([node('a', { originalStorageKey: 'image:missing' })]), new Map(), []));
});

test('坏连线、重复节点、空包和无效尺寸不产生可导入结果', () => {
    for (const data of [document([node('a')], [edge('e', 'a', 'absent')]), document([node('a'), node('a')]), document([]), document([{ ...node('a'), width: -1 }]), { app: 'other', version: 3, projects: [] }]) assert.throws(() => prepare(data, new Map(), []));
});

test('导入快照移除旧视频任务并把未完成状态改为待重试', () => {
    const data = document([node('video', { status: 'loading', videoTaskId: 'old-task', videoTaskProvider: 'openai', images: [{ status: 'loading' }], texts: [{ status: 'loading' }] }, 'video')]);
    const metadata = prepare(data, new Map(), []).nodes[0].metadata;
    assert.equal(metadata.status, 'error');
    assert.equal(metadata.images[0].status, 'error');
    assert.equal(metadata.texts[0].status, 'error');
    assert.ok(!('videoTaskId' in metadata));
    assert.equal(data.projects[0].project.nodes[0].metadata.videoTaskId, 'old-task');
});

test('多个画布包顺序追加并保留各自独立的节点关系', () => {
    const data = document([node('a')]);
    data.projects.push(document([node('a')]).projects[0]);
    const result = prepare(data, new Map(), []);
    assert.notEqual(result.nodes[0].id, result.nodes[1].id);
    assert.ok(result.nodes[1].position.x >= result.nodes[0].position.x + result.nodes[0].width + 80);
});

const scene = () => [node('group', {}, 'group'), node('params', { promptVariableSourceNodeId: 'source', promptVariablePreviewNodeId: 'preview', promptVariableRawPrompt: 'raw', promptVariableResolvedPrompt: 'resolved' }, 'guan:prompt-variables'), node('source', { groupId: 'group', excelPromptBindingNodeId: 'params', excelPromptResolved: 'resolved' }), node('preview', { promptVariablePreviewOf: 'params', promptVariableSourceNodeId: 'source' })];
const edges = () => [edge('a', 'params', 'source'), edge('b', 'source', 'preview')];

test('删除参数连同关联预览进批次，保留提示词关系快照和媒体引用', () => {
    const nodes = scene();
    nodes[1].metadata.originalStorageKey = 'image:keep';
    const result = recycle(nodes, edges(), new Set(['params']), []);
    assert.deepEqual(result.batches[0].nodes.map(n => n.id), ['params', 'preview']);
    assert.equal(result.batches[0].nodes[0].metadata.originalStorageKey, 'image:keep');
    assert.equal(result.nodes.find(n => n.id === 'source').metadata.excelPromptBindingNodeId, undefined);
    assert.equal(result.batches[0].relatedNodes[0].id, 'source');
    assert.equal(nodes[2].metadata.excelPromptBindingNodeId, 'params');
});

test('删除源提示词后恢复时还原参数和连线', () => {
    const deleted = recycle(scene(), edges(), new Set(['source']), []);
    const restored = restore(deleted.nodes, deleted.connections, deleted.batches[0]);
    const params = restored.nodes.find(n => n.id === 'params');
    assert.equal(params.metadata.promptVariableSourceNodeId, 'source');
    assert.equal(params.metadata.promptVariableRawPrompt, 'raw');
    assert.equal(params.metadata.promptVariablePreviewNodeId, 'preview');
    assert.equal(restored.connections.length, 2);
});

test('分组删除后恢复成员groupId，不改成员后续内容', () => {
    const deleted = recycle(scene(), edges(), new Set(['group']), []);
    const edited = deleted.nodes.map(n => n.id === 'source' ? { ...n, metadata: { ...n.metadata, content: 'edited' } } : n);
    const restored = restore(edited, deleted.connections, deleted.batches[0]);
    assert.equal(restored.nodes.find(n => n.id === 'source').metadata.groupId, 'group');
    assert.equal(restored.nodes.find(n => n.id === 'source').metadata.content, 'edited');
});

test('恢复不覆盖用户重新绑定的来源及提示词', () => {
    const deleted = recycle(scene(), edges(), new Set(['source']), []);
    const edited = [...deleted.nodes.map(n => n.id === 'params' ? { ...n, metadata: { ...n.metadata, promptVariableSourceNodeId: 'new-source', promptVariableRawPrompt: 'new raw' } } : n), node('new-source')];
    const restored = restore(edited, deleted.connections, deleted.batches[0]);
    const params = restored.nodes.find(n => n.id === 'params');
    assert.equal(params.metadata.promptVariableSourceNodeId, 'new-source');
    assert.equal(params.metadata.promptVariableRawPrompt, 'new raw');
    assert.equal(params.metadata.promptVariablePreviewNodeId, undefined);
});

test('撤销后重复恢复不重复节点、连线或覆盖编辑', () => {
    const nodes = scene(), deleted = recycle(nodes, edges(), new Set(['source']), []);
    nodes[2] = { ...nodes[2], title: 'edited title' };
    const result = restore(nodes, edges(), deleted.batches[0]);
    assert.equal(result.nodes.length, nodes.length);
    assert.equal(result.connections.length, 2);
    assert.equal(result.nodes.find(n => n.id === 'source').title, 'edited title');
});

test('再次删除恢复的子集，旧批次其他节点仍可恢复', () => {
    const first = recycle([node('a'), node('b')], [], new Set(['a', 'b']), []);
    const second = recycle([node('a')], [], new Set(['a']), first.batches);
    assert.deepEqual(second.batches.map(batch => batch.nodes.map(n => n.id)), [['b'], ['a']]);
});

test('缺端点不恢复连线，空选择不创建批次', () => {
    const batch = { id: 'batch', nodes: [node('a')], connections: [edge('e', 'a', 'missing')], deletedAt: new Date().toISOString() };
    assert.equal(restore([], [], batch).connections.length, 0);
    assert.equal(recycle([node('a')], [], new Set(['absent']), []), null);
});

test('永久移除从历史剔除节点及边、清理悬空关系并保留其他字段', () => {
    const result = prune({ nodes: scene(), connections: edges(), activeChatId: 'chat' }, new Set(['source', 'preview']));
    assert.deepEqual(result.nodes.map(n => n.id), ['group', 'params']);
    assert.equal(result.connections.length, 0);
    assert.equal(result.nodes[1].metadata.promptVariableSourceNodeId, undefined);
    assert.equal(result.activeChatId, 'chat');
});
