import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { generatedImageName } from '../扩展功能/媒体交付/生成图片命名.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function compile(name, dependencies = {}) {
    const file = resolve(root, name), module = { exports: {} };
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未注入依赖：' + id);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const sizing = await compile('.运行/3100源/画布副本/web/src/lib/canvas/canvas-node-size.ts');
const api = await compile('扩展功能/媒体交付/图片批次操作.ts', {
    react: { useCallback: value => value }, nanoid: { nanoid: () => 'copy' },
    '@/lib/canvas/canvas-node-size': sizing, '@/types/canvas': { CanvasNodeType: { Image: 'image', Text: 'text' } },
    './生成图片命名': { generatedImageName },
});
function image(id, width = 800, height = 400) {
    return { id, name: `主图-${id}`, content: `blob:${id}`, status: 'success', storageKey: `image:${id}-delivery`,
        naturalWidth: width, naturalHeight: height, bytes: 100, mimeType: 'image/png',
        deliveryStorageKey: `image:${id}-delivery`, deliveryWidth: width, deliveryHeight: height, deliveryBytes: 100, deliveryMimeType: 'image/png',
        originalStorageKey: `image:${id}-original`, originalWidth: width * 2, originalHeight: height * 2, originalBytes: 300, originalMimeType: 'image/webp' };
}
function node(images = [image('1'), image('2', 200, 600)]) {
    const { id: _id, name: _name, ...first } = images[0];
    return { id: 'batch', type: 'image', title: '主图-1', position: { x: 100, y: 200 }, width: 400, height: 200,
        metadata: { ...first, images, primaryImageId: images[0].id, count: images.length, prompt: '用户原文', generationType: 'generation',
            model: '模型', quality: 'high', size: '800x400', requestedSize: '800x400', references: ['原始参考'], gatewayGenerationTasks: [{ taskId: 'pending' }] } };
}
function center(value) { return { x: value.position.x + value.width / 2, y: value.position.y + value.height / 2 }; }

test('切换主图同步完整原图/交付图及尺寸，保留中心、生成配置和原输入', () => {
    const source = node(), before = structuredClone(source), result = api.selectBatchPrimary(source, '2');
    assert.deepEqual(source, before);
    assert.deepEqual(center(result), center(source));
    assert.ok(Math.abs(result.width / result.height - 1 / 3) < 1e-12);
    for (const key of ['content', 'storageKey', 'naturalWidth', 'naturalHeight', 'bytes', 'mimeType', 'originalStorageKey', 'originalWidth', 'originalHeight', 'originalBytes', 'originalMimeType', 'deliveryStorageKey', 'deliveryWidth', 'deliveryHeight', 'deliveryBytes', 'deliveryMimeType']) {
        assert.equal(result.metadata[key], source.metadata.images[1][key], key);
    }
    assert.equal(result.metadata.deliverySize, '200x600');
    assert.equal(result.metadata.prompt, source.metadata.prompt);
    assert.equal(result.metadata.primaryImageId, '2');
});
test('旧批次缺少原图信息时清空上一张字段；自由尺寸和文本主项保持作者交互', () => {
    const source = node(); source.metadata.freeResize = true;
    const selected = source.metadata.images[1];
    for (const key of Object.keys(selected)) if (/^(original|delivery)/.test(key)) delete selected[key];
    const result = api.selectBatchPrimary(source, '2');
    assert.deepEqual([result.width, result.height, result.position], [source.width, source.height, source.position]);
    assert.equal(result.metadata.originalStorageKey, undefined);
    assert.equal(result.metadata.originalWidth, undefined);
    assert.equal(result.metadata.deliveryStorageKey, undefined);
    const text = { id: 'text', type: 'text', metadata: { content: '甲', primaryTextId: 'a', texts: [{ id: 'a', content: '甲' }, { id: 'b', content: '乙' }] } };
    assert.equal(api.selectBatchPrimary(text, 'b').metadata.content, '乙');
    assert.equal(api.selectBatchPrimary(text, 'a'), text);
    assert.equal(api.selectBatchPrimary(source, 'missing'), source);
});
test('复制第二张保留稳定编号、原图、交付图及配置，不复制整批或任务所有权', () => {
    const source = node(), copy = api.copyBatchImage(source, '2', 'copy');
    assert.equal(copy.title, '主图-2');
    assert.equal(generatedImageName(copy), '主图-2');
    assert.equal(copy.metadata.originalStorageKey, 'image:2-original');
    assert.equal(copy.metadata.deliveryStorageKey, 'image:2-delivery');
    assert.equal(copy.metadata.originalWidth, 400);
    assert.equal(copy.metadata.quality, 'high');
    assert.equal(copy.metadata.images, undefined);
    assert.equal(copy.metadata.gatewayGenerationTasks, undefined);
    assert.deepEqual(copy.metadata.references, source.metadata.references);
    assert.notEqual(copy.metadata.references, source.metadata.references);
    assert.equal(api.copyBatchImage(source, 'missing', 'copy'), null);
});
test('删除主图跳过失败槽，切到剩余成功图；删除其他槽保留当前主图', () => {
    const source = node([image('1'), { id: 'failed', status: 'error', errorDetails: '失败' }, image('2', 200, 600)]);
    const before = structuredClone(source), result = api.removeBatchImage(source, '1');
    assert.deepEqual(source, before);
    assert.equal(result.metadata.primaryImageId, '2');
    assert.equal(result.metadata.content, 'blob:2');
    assert.equal(result.metadata.originalStorageKey, 'image:2-original');
    assert.equal(result.metadata.storageKey, 'image:2-delivery');
    assert.equal(result.metadata.count, 2);
    assert.deepEqual(center(result), center(source));
    const second = api.removeBatchImage(result, 'failed');
    assert.equal(second.metadata.content, result.metadata.content);
    assert.equal(second.metadata.primaryImageId, '2');
    assert.equal(second.metadata.images[0].name, '主图-2');
    assert.equal(api.removeBatchImage(second, 'missing'), second);
});
for (const [label, remaining, expected] of [
    ['只剩失败', [{ id: 'failed', status: 'error', errorDetails: '生成失败' }], 'error'],
    ['仍有未决', [{ id: 'loading', status: 'loading' }, { id: 'failed', status: 'error' }], 'loading'],
    ['只剩空槽', [{ id: 'idle', status: 'idle' }], 'idle'],
    ['最后一张', [], 'idle'],
]) test(`删除主图${label}时清除旧素材信息，状态与剩余槽一致`, () => {
    const result = api.removeBatchImage(node([image('1'), ...remaining]), '1');
    assert.equal(result.metadata.content, '');
    for (const key of ['primaryImageId', 'storageKey', 'originalStorageKey', 'deliveryStorageKey', 'originalWidth', 'naturalWidth', 'bytes', 'deliverySize']) assert.equal(result.metadata[key], undefined, key);
    assert.equal(result.metadata.status, expected);
    assert.equal(result.metadata.count, remaining.length);
    assert.equal(result.metadata.gatewayGenerationTasks[0].taskId, 'pending');
});
test('迟到复制读取当前结果；已删卡片/槽不写历史、不折叠、不改变选择', () => {
    const old = node(), current = node(); current.metadata.images[1] = image('2', 900, 900);
    current.metadata.images[1].originalStorageKey = 'image:new-original';
    const ref = { current: [current] }, selected = [], dialogs = [];
    let writes = 0, folds = 0;
    const hooks = api.useCanvasImageBatches({ nodesRef: ref, setNodes: update => { writes++; ref.current = update(ref.current); },
        setExpandedBatchNodeIds: () => { folds++; }, setSelectedNodeIds: value => selected.push([...value]), setSelectedConnectionId: () => {}, setDialogNodeId: value => dialogs.push(value) });
    hooks.deleteBatchImage('batch', 'missing'); hooks.setBatchPrimary('batch', 'missing');
    assert.equal(writes, 0); assert.equal(folds, 0);
    hooks.duplicateBatchImage(old, '2');
    assert.equal(ref.current[1].metadata.originalStorageKey, 'image:new-original');
    assert.equal(ref.current[1].metadata.naturalWidth, 900);
    assert.deepEqual(selected, [['copy']]); assert.deepEqual(dialogs, ['copy']);
    ref.current = [];
    hooks.duplicateBatchImage(old, '2'); hooks.deleteBatchImage('batch', '2'); hooks.setBatchPrimary('batch', '2');
    assert.equal(writes, 1); assert.equal(folds, 0); assert.equal(selected.length, 1);
});
