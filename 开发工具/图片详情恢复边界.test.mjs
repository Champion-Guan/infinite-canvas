import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import ts from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { generatedImageName } from '../扩展功能/媒体交付/生成图片命名.js';

const root = fileURLToPath(new URL('..', import.meta.url));
async function load(name, dependencies) {
    const file = resolve(root, '扩展功能/媒体交付', name);
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: name.endsWith('.tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const data = await load('图片详情数据.ts', { './生成图片命名': { generatedImageName } });
const node = { id: 'image', type: 'image', title: '详情页03-1', metadata: { generationType: 'edit', channel: '真实渠道', model: 'gpt-image-model', size: '900x1200', quality: 'auto', count: 1,
    content: 'local:delivery', storageKey: 'delivery', naturalWidth: 1086, naturalHeight: 1448, bytes: 2800000, mimeType: 'image/png' } };

test('恢复生成参数、请求/实际尺寸和格式，详情与下载使用同一实际文件', () => {
    const before = structuredClone(node), detail = data.imageDetailData(node);
    assert.equal(detail.source, '图片编辑'); assert.equal(detail.imageType, 'edit');
    assert.equal(detail.requestedDimensions, '900x1200'); assert.equal(detail.responseDimensions, '1086x1448');
    assert.equal(detail.sizeMatches, false); assert.equal(detail.bytes, 2800000); assert.equal(detail.format, 'png');
    assert.equal(detail.file.storageKey, 'delivery'); assert.equal(detail.file.content, 'local:delivery');
    assert.equal(detail.moderation, 'auto'); assert.deepEqual(node, before);
});
test('同尺寸归一化，不重复显示黄色差异；未知信息保持未知', () => {
    const detail = data.imageDetailData({ ...node, metadata: { ...node.metadata, size: '1086 × 1448' } });
    assert.equal(detail.sizeMatches, true);
    const unknown = data.imageDetailData({ id: 'unknown', type: 'image', metadata: { content: 'blob:actual' } });
    assert.equal(unknown.dimensions, '暂无'); assert.equal(unknown.format, '暂无'); assert.equal(unknown.bytes, 0);
    assert.equal(data.imageDetailData({ ...node, metadata: {} }), null);
});
test('批次缺少根content仍可预览主图；显式槽位不借用其他图片数据', () => {
    const batch = { ...node, metadata: { ...node.metadata, content: undefined, storageKey: undefined, primaryImageId: 'b', images: [
        { id: 'a', content: 'local:a', storageKey: 'a', naturalWidth: 900, naturalHeight: 1200, bytes: 1, mimeType: 'image/png' },
        { id: 'b', content: 'local:b', storageKey: 'b', naturalWidth: 1584, naturalHeight: 992, bytes: 2, mimeType: 'image/webp' },
    ] } };
    assert.equal(data.imageDetailData(batch).file.storageKey, 'b');
    const explicit = data.imageDetailData(batch, 'a');
    assert.equal(explicit.file.storageKey, 'a'); assert.equal(explicit.dimensions, '900x1200'); assert.equal(explicit.bytes, 1);
    assert.equal(data.imageDetailData(batch, 'missing'), null);
});
test('原生图片与交付图分开记录，请求、原响应和最终尺寸均保持真实', () => {
    const detail = data.imageDetailData({ ...node, metadata: { ...node.metadata, naturalWidth: 900, naturalHeight: 1200,
        originalWidth: 1086, originalHeight: 1448, originalStorageKey: 'original', deliveryNote: '按目标尺寸适配' } });
    assert.equal(detail.dimensions, '900x1200'); assert.equal(detail.responseDimensions, '1086x1448');
    assert.equal(detail.originalStorageKey, 'original'); assert.equal(detail.file.storageKey, 'delivery');
    assert.equal(detail.deliveryNote, '按目标尺寸适配');
});
test('兼容旧原图结构、仅持久键文件及data URL格式', () => {
    const legacy = data.imageDetailData({ ...node, metadata: { ...node.metadata, content: '', originalImage: { width: 2048, height: 2048, storageKey: 'legacy-original' } } });
    assert.equal(legacy.responseDimensions, '2048x2048'); assert.equal(legacy.originalStorageKey, 'legacy-original');
    const inline = data.imageDetailData({ ...node, metadata: { content: 'data:image/jpeg;base64,YQ==' } });
    assert.equal(inline.format, 'jpg');
});

const jsx = (type, props, key) => ({ type, props: props || {}, key });
function elements(tree) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(elements);
    return [tree, ...elements(tree.props?.children)];
}
test('真实详情组件展示全部信息及下载按钮；关闭入口回调，卸载后不继续读取预览', async () => {
    const downloads = [], theme = { node: { panel: '#fff', text: '#222', muted: '#777', stroke: '#ddd' } };
    let previewReads = 0, closed = 0;
    const { CanvasImageDetails } = await load('图片详情面板.tsx', {
        'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { App: { useApp: () => ({ message: {} }) }, Modal: 'Modal', Spin: 'Spin', Tooltip: 'Tooltip' },
        '@/lib/image-utils': { formatBytes: () => '2.8 MB', getDataUrlByteSize: () => 1 },
        '@/stores/use-config-store': { decodeChannelModel: value => ({ model: value }) },
        '../生成历史/历史下载操作': { useHistoryDownloads: () => ({ downloading: false, downloadFile: file => downloads.push(file) }) },
        '../生成历史/历史媒体预览': { useHistoryMediaPreview: file => { previewReads++; return { url: 'blob:' + file.storageKey }; } },
        './图片详情数据': data, './图片详情面板.module.css': { default: {} },
    });
    const props = { node, open: true, theme, onClose: () => { closed++; } };
    const shell = CanvasImageDetails(props), tree = shell.type(shell.props);
    const rendered = JSON.stringify(tree);
    for (const text of ['生成来源', '使用渠道', '使用模型', '生图类型', '尺寸', '图片格式', '文件大小', '审核', '质量', '生成数量', '背景设置', '下载图片', '真实渠道', '1086x1448', '2.8 MB']) assert.ok(rendered.includes(text), text);
    elements(tree.props.title).find(item => item.type === 'button').props.onClick();
    assert.equal(downloads[0].storageKey, 'delivery');
    tree.props.onCancel(); assert.equal(closed, 1);
    assert.equal(CanvasImageDetails({ ...props, open: false }), null); assert.equal(previewReads, 1);
    const originalShell = CanvasImageDetails({ ...props, node: { ...node, metadata: { ...node.metadata, originalStorageKey: 'original' } } });
    const originalTree = originalShell.type(originalShell.props);
    elements(originalTree).find(item => item.type === 'button' && item.props.children === '下载原生图片').props.onClick();
    assert.equal(downloads[1].storageKey, 'original'); assert.equal(downloads[1].content, '');
});
test('接线替换简化弹窗、关闭清除槽位，历史行内下载未恢复，Hook依赖合法', () => {
    const patch = readFileSync(resolve(root, '上游适配/图片详情面板接入.patch'), 'utf8');
    assert.match(patch, /CanvasImageDetails node=\{previewNode\}/); assert.match(patch, /setPreviewImageId\(null\)/);
    const history = readFileSync(resolve(root, '扩展功能/生成历史/生成历史页签.tsx'), 'utf8');
    assert.ok(!history.includes('title={`下载 ${file.name}`}'));
    const linter = new Linter(), file = resolve(root, '扩展功能/媒体交付/图片详情面板.tsx');
    const messages = linter.verify(readFileSync(file, 'utf8'), [{ files: ['**/*.tsx'], languageOptions: { parser: ts.parser, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' } }], { filename: file });
    assert.deepEqual(messages, []);
});

test('逐图请求尺寸和说明优先，旧主图说明兼容但不泄漏给其他槽', () => {
    const batch = { ...node, metadata: { ...node.metadata, primaryImageId: 'a', requestedSize: '900x1200', deliveryNote: '旧主图说明', images: [
        { id: 'a', content: 'local:a', storageKey: 'a', naturalWidth: 900, naturalHeight: 1200 },
        { id: 'b', content: 'local:b', storageKey: 'b', requestedSize: '800x500', upstreamSize: '1024x640', naturalWidth: 800, naturalHeight: 500 },
    ] } };
    assert.equal(data.imageDetailData(batch, 'a').deliveryNote, '旧主图说明');
    const second = data.imageDetailData(batch, 'b');
    assert.equal(second.deliveryNote, undefined); assert.equal(second.requestedDimensions, '800x500'); assert.equal(second.upstreamSize, '1024x640');
});
