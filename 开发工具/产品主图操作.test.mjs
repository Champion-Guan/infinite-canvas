import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function load(name, dependencies = {}) {
    dependencies = { '../主题/苹果弹窗': { AppleModal: 'Modal' }, './参数图片预览': { ParameterImageThumbnail: 'ParameterImageThumbnail' }, ...dependencies };
    const source = readFileSync(new URL('../扩展功能/Excel画布/' + name, import.meta.url), 'utf8');
    const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', javascript)(id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, module, module.exports);
    return module.exports;
}
const rules = load('产品主图规则.ts');
const assetRules = load('../素材/上传资产规则.ts');
const emptyAssets = { getState: () => ({ assets: [] }) };
const original = { id: 'a', name: '主图.png', storageKey: 'image:original', width: 1087, height: 1447, mimeType: 'image/png' };
const second = { id: 'b', name: '侧面.png', storageKey: 'image:side' };
const cutout = { storageKey: 'image:cutout', url: 'blob:cutout', width: 1024, height: 1536, mimeType: 'image/png' };
const jsx = (type, props) => ({ type, props });
const elements = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];

test('删除已分配主图同时清理所有变体及共用引用，主参考图回退到剩余图片，保存恢复不留旧数量', () => {
    const variant = (id, imageIds, primaryImageId) => ({ id, imageIds, primaryImageId, name: id, enabled: true, attributes: { 颜色: '红色' } });
    const metadata = { productMainImages: [original, second], productSharedImageIds: ['a', 'b'],
        productVariants: [variant('single', ['a'], 'a'), variant('multiple', ['a', 'b'], 'a'), variant('other', ['b'], 'b')] };
    const before = structuredClone(metadata);
    const patch = rules.removeProductMainImagePatch(metadata, 'a');
    assert.deepEqual(patch.productMainImages, [second]);
    assert.deepEqual(patch.productSharedImageIds, ['b']);
    assert.deepEqual(patch.productVariants.map(item => [item.imageIds, item.primaryImageId]), [[[], undefined], [['b'], 'b'], [['b'], 'b']]);
    assert.equal(patch.productVariants[2], metadata.productVariants[2]);
    assert.deepEqual(metadata, before);
    const restored = JSON.parse(JSON.stringify({ ...metadata, ...patch }));
    assert.equal(restored.productVariants[0].imageIds.length, 0);
    assert.equal(restored.productVariants[0].primaryImageId, undefined);
    assert.equal(restored.productVariants[0].attributes.颜色, '红色');
    const empty = rules.removeProductMainImagePatch(restored, 'b');
    assert.deepEqual(empty.productSharedImageIds, []);
    assert.ok(empty.productVariants.every(item => item.imageIds.length === 0 && item.primaryImageId === undefined));
    assert.deepEqual(rules.productMainImages({ ...restored, ...empty }), []);
    assert.equal(empty.productMainImageStorageKey, undefined);
});

test('真实删除按钮从最新节点一次更新主图和变体，保留渲染后新增的分配及其他资料', () => {
    let node = { id: 'parameter', metadata: { ...rules.productMainImagesPatch([original, second]),
        productVariants: [{ id: 'one', name: '红色', enabled: true, attributes: {}, imageIds: ['a'], primaryImageId: 'a' }] } };
    const writes = [], ctx = { node, theme: { node: {}, toolbar: {} }, getNode: () => node,
        updateMetadata(patch) { writes.push(patch); node = { ...node, metadata: { ...node.metadata, ...patch } }; } };
    const component = load('产品主图上传.tsx', {
        react: { useRef: current => ({ current }), useState: value => [value, () => {}], useEffect() {} },
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': {}, './产品主图规则': rules,
        '../素材/上传资产规则': assetRules, '@/stores/use-asset-store': { useAssetStore: emptyAssets },
    });
    const tree = elements(component.ProductMainImageUploader({ ctx, productId: 'product' }));
    node.metadata.productVariants.push({ id: 'two', name: '后来添加', enabled: true, attributes: {}, imageIds: ['a', 'b'], primaryImageId: 'a' });
    node.metadata.productSharedImageIds = ['a'];
    tree.find(element => element.type === 'button' && element.props['aria-label'] === '移除产品主图 1：主图.png').props.onClick();
    assert.equal(writes.length, 1);
    assert.deepEqual(node.metadata.productVariants.map(variant => variant.imageIds), [[], ['b']]);
    assert.equal(node.metadata.productVariants[1].primaryImageId, 'b');
    assert.deepEqual(node.metadata.productSharedImageIds, []);
    const restored = JSON.parse(JSON.stringify(node));
    restored.metadata.productVariants[0] = { ...restored.metadata.productVariants[0], imageIds: ['b'], primaryImageId: 'b' };
    assert.deepEqual(restored.metadata.productMainImages, [second]);
    assert.equal(restored.metadata.productVariants[0].imageIds.length, 1);
});

test('旧单图无损读取；多图无张数限制；空列表不复活旧图片，保存后结构完整', () => {
    const legacy = { productMainImageStorageKey: 'image:old', productMainImageWidth: 900, productMainImageHeight: 1200 };
    const first = rules.productMainImages(legacy);
    assert.equal(first[0].storageKey, 'image:old'); assert.equal(first[0].width, 900);
    const images = [...first, ...Array.from({ length: 100 }, (_, index) => ({ ...second, id: String(index) }))];
    const persisted = JSON.parse(JSON.stringify(rules.productMainImagesPatch(images)));
    assert.equal(rules.productMainImages(persisted).length, 101);
    assert.equal(persisted.productMainImageStorageKey, 'image:old');
    assert.deepEqual(rules.productMainImages({ ...legacy, productMainImages: [] }), []);
    assert.equal(rules.productMainImagesPatch([]).productMainImageStorageKey, undefined);
});

test('去背景、还原、再次使用结果均保留原始尺寸及图片，互不影响其他主图', () => {
    const changed = rules.applyProductImageCutout(original, cutout);
    assert.equal(changed.storageKey, cutout.storageKey); assert.equal(changed.width, 1024);
    assert.equal(changed.original.storageKey, original.storageKey); assert.equal(changed.original.width, 1087);
    const restored = rules.restoreProductMainImage(JSON.parse(JSON.stringify(changed)));
    assert.equal(restored.storageKey, original.storageKey); assert.equal(restored.width, 1087);
    assert.equal(restored.backgroundRemoved, false); assert.equal(restored.cutout.storageKey, cutout.storageKey);
    const again = rules.applyProductImageCutout(restored, restored.cutout);
    assert.equal(again.original.storageKey, original.storageKey);
    assert.deepEqual([original, second][1], second);
});

function backgroundHarness(request) {
    let node = { id: 'parameter', metadata: { status: 'success', productMainImages: [original, second] } };
    const saves = [], requests = [], uploads = [];
    const ctx = { node, getNode: () => node, updateMetadata(patch) { node = { ...node, metadata: { ...node.metadata, ...patch } }; } };
    const { removeProductMainImageBackground } = load('产品主图去背景.ts', {
        '../产品配置/模型配置门禁': { requireModelConfigured() {} },
        './产品主图规则': rules,
        '../画布生成/原画布图片调用': { requestCanvasImage: async options => { requests.push(options); await request(options, () => node, value => { node = value; }); } },
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({ config: {}, isAiConfigReady: () => true }) } },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: () => ({ model: 'configured::image', count: '5', size: '3:4' }) },
        '../产品/产品操作': { saveProductCanvas: async id => { saves.push(id); return { persisted: true, deferred: false }; } },
        '@/services/image-storage': { uploadImage: async (data, options) => { uploads.push({ data, options }); return cutout; } },
    });
    return { run: () => removeProductMainImageBackground({ ctx, productId: 'product', imageId: 'a', signal: new AbortController().signal }),
        read: () => node, requests, uploads, saves };
}

test('去背景通过原任务端口，先保存身份再提交；逐图回写并保存收据，不增加结果卡片', async () => {
    const task = { taskId: 'job-a', slotId: 'product-main-image:a' };
    const receipt = { taskId: 'job-a', responseHash: 'hash' };
    const harness = backgroundHarness(async (options, read) => {
        assert.equal(options.references.length, 1); assert.equal(options.references[0].storageKey, original.storageKey);
        assert.equal(options.config.background, 'transparent'); assert.equal(options.config.size, 'auto');
        assert.equal(options.config.count, '1'); assert.equal(options.config.model, 'configured::image');
        await options.recordTask(task);
        assert.deepEqual(read().metadata.gatewayGenerationTasks, [task]);
        await options.applyAndSave({ dataUrl: 'data:image/png;base64,cutout' }, receipt);
    });
    await harness.run();
    assert.equal(harness.read().metadata.productMainImages[0].storageKey, cutout.storageKey);
    assert.deepEqual(harness.read().metadata.productMainImages[1], second);
    assert.deepEqual(harness.read().metadata.gatewayGenerationReceipts, [receipt]);
    assert.equal(harness.uploads[0].options.registerAsset, false);
    assert.deepEqual(harness.saves, ['product', 'product']);
});

test('上游失败保留原图，删除或更改后的迟到结果不会覆盖当前图片', async () => {
    const failed = backgroundHarness(async () => { throw Error('provider failed'); });
    await assert.rejects(failed.run(), /provider failed/);
    assert.deepEqual(failed.read().metadata.productMainImages, [original, second]);
    assert.equal(failed.uploads.length, 0);
    for (const images of [[second], [{ ...original, storageKey: 'image:replaced' }, second]]) {
        const late = backgroundHarness(async (options, read, write) => {
            await options.recordTask({ taskId: 'job', slotId: 'product-main-image:a' });
            write({ ...read(), metadata: { ...read().metadata, productMainImages: images } });
            await options.applyAndSave({ dataUrl: 'data:image/png;base64,late' }, { taskId: 'job' });
        });
        await assert.rejects(late.run(), /已移除|已更改/);
        assert.deepEqual(late.read().metadata.productMainImages, images);
        assert.equal(late.uploads.length, 0);
    }
});

test('多选追加保留旧主图，部分文件失败不丢成功图片；再次追加并发读取最新元数据', async () => {
    let node = { id: 'parameter', metadata: { productMainImages: [original] } };
    const ctx = { node, theme: { node: {}, toolbar: {} }, getNode: () => node,
        updateMetadata(patch) { node = { ...node, metadata: { ...node.metadata, ...patch } }; } };
    const hooks = [], effects = []; let cursor = 0;
    const component = load('产品主图上传.tsx', {
        react: {
            useRef(value) { const index = cursor++; return hooks[index] ||= { current: value }; },
            useState(value) { const index = cursor++; hooks[index] ??= { value }; return [hooks[index].value, next => { hooks[index].value = next; }]; },
            useEffect(callback) { if (!effects.length) effects.push(callback); },
        },
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'antd': { Modal: 'Modal' }, 'lucide-react': {},
        '../媒体交付/媒体缩略图': { MediaThumbnail: 'MediaThumbnail' }, './产品主图规则': rules,
        '../素材/上传资产规则': assetRules, '@/stores/use-asset-store': { useAssetStore: emptyAssets },
        '@/services/image-storage': { uploadImage: async file => {
            if (file.name === 'bad.png') throw Error('无法读取');
            // 模拟上传期间另一张图片已追加到当前节点，不能用渲染时旧列表覆盖。
            if (file.name === 'one.png') node.metadata.productMainImages = [...node.metadata.productMainImages, second];
            return { storageKey: `image:${file.name}` };
        } },
    });
    const render = () => { cursor = 0; ctx.node = node; return elements(component.ProductMainImageUploader({ ctx, productId: 'product' })); };
    let tree = render(); const cleanup = effects[0]();
    try {
        const input = tree.find(element => element.type === 'input');
        assert.equal(input.props.multiple, true); assert.equal(input.props.accept, 'image/*,.heic,.heif');
        input.props.onChange({ currentTarget: { files: [{ name: 'one.png' }, { name: 'bad.png' }, { name: 'two.png' }], value: 'selected' } });
        for (let turn = 0; turn < 20; turn++) await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(node.metadata.productMainImages.map(image => image.storageKey), ['image:original', 'image:side', 'image:one.png', 'image:two.png']);
        tree = render();
        assert.match(tree.find(element => element.props?.role === 'alert').props.children, /bad.png：无法读取/);
        assert.equal(tree.filter(element => element.type === 'ParameterImageThumbnail').length, 4);
        assert.equal(tree.find(element => element.type === 'ParameterImageThumbnail').props.image.storageKey, 'image:original');
        assert.ok(tree.some(element => element.type === 'button' && element.props['aria-label']?.startsWith('移除背景 产品主图')));
    } finally { cleanup(); }
});

test('页面还原与重新使用去背景结果只切换本图，不再请求生图且保存后仍可还原', () => {
    let node = { id: 'parameter', metadata: JSON.parse(JSON.stringify(rules.productMainImagesPatch([
        rules.applyProductImageCutout(original, cutout), second,
    ]))) };
    const ctx = { node, theme: { node: {}, toolbar: {} }, getNode: () => node,
        updateMetadata(patch) { node = { ...node, metadata: { ...node.metadata, ...patch } }; } };
    const component = load('产品主图上传.tsx', {
        react: { useRef: current => ({ current }), useState: value => [value, () => {}], useEffect: () => {} },
        'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Modal: 'Modal' }, 'lucide-react': {},
        '../媒体交付/媒体缩略图': { MediaThumbnail: 'MediaThumbnail' }, './产品主图规则': rules,
        '../素材/上传资产规则': assetRules, '@/stores/use-asset-store': { useAssetStore: emptyAssets },
    });
    const action = name => {
        ctx.node = node;
        const button = elements(component.ProductMainImageUploader({ ctx, productId: 'product' }))
            .find(element => element.type === 'button' && element.props['aria-label'] === `${name} 产品主图 1：主图.png`);
        assert.ok(button);
        button.props.onClick();
    };
    action('还原');
    assert.equal(node.metadata.productMainImages[0].storageKey, original.storageKey);
    assert.equal(node.metadata.productMainImages[0].backgroundRemoved, false);
    action('移除背景');
    assert.equal(node.metadata.productMainImages[0].storageKey, cutout.storageKey);
    action('还原');
    assert.equal(node.metadata.productMainImages[0].storageKey, original.storageKey);
    assert.deepEqual(node.metadata.productMainImages[1], second);
});

function dropHarness({ assets = [], uploadImage = async file => ({ storageKey: `image:${file.name}` }) } = {}) {
    let node = { id: 'parameter', metadata: rules.productMainImagesPatch([original]) };
    const hooks = [], effects = [], uploads = [];
    let cursor = 0;
    const ctx = { node, theme: { node: {}, toolbar: {} }, getNode: () => node,
        updateMetadata(patch) { node = { ...node, metadata: { ...node.metadata, ...patch } }; } };
    const component = load('产品主图上传.tsx', {
        react: {
            useRef(value) { const index = cursor++; return hooks[index] ||= { current: value }; },
            useState(value) { const index = cursor++; hooks[index] ??= { value }; return [hooks[index].value, next => { hooks[index].value = next; }]; },
            useEffect(callback) { if (!effects.length) effects.push(callback); },
        },
        'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Modal: 'Modal' }, 'lucide-react': {},
        '../媒体交付/媒体缩略图': { MediaThumbnail: 'MediaThumbnail' }, './产品主图规则': rules,
        '../素材/上传资产规则': assetRules, '@/stores/use-asset-store': { useAssetStore: { getState: () => ({ assets }) } },
        '@/services/image-storage': { uploadImage: async (...args) => { uploads.push(args); return uploadImage(...args); } },
    });
    const render = () => { cursor = 0; ctx.node = node; return elements(component.ProductMainImageUploader({ ctx, productId: 'product' })); };
    render();
    const cleanup = effects[0]();
    return { render, cleanup, uploads, read: () => node,
        zone: () => render().find(element => element.type === 'section'),
        error: () => render().find(element => element.props?.role === 'alert')?.props.children };
}

function dragEvent({ files = [], data = {}, types = files.length ? ['Files'] : Object.keys(data) } = {}) {
    return { prevented: false, stopped: false, dataTransfer: { types, files, getData: type => data[type] || '' },
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
}
const settleUploads = async () => { for (let turn = 0; turn < 20; turn++) await new Promise(resolve => setImmediate(resolve)); };

test('整个产品主图区接收拖放，跨越子元素时高亮保持，离开后恢复；阻止画布重复处理', () => {
    const harness = dropHarness();
    try {
        const enter = dragEvent({ types: ['Files'] });
        harness.zone().props.onDragEnter(enter);
        assert.equal(enter.prevented, true); assert.equal(enter.stopped, true);
        assert.equal(harness.zone().props['data-drag-active'], true);
        harness.zone().props.onDragEnter(dragEvent({ types: ['Files'] }));
        harness.zone().props.onDragLeave(dragEvent({ types: ['Files'] }));
        assert.equal(harness.zone().props['data-drag-active'], true);
        harness.zone().props.onDragLeave(dragEvent({ types: ['Files'] }));
        assert.equal(harness.zone().props['data-drag-active'], undefined);
        const over = dragEvent({ types: ['Files'] });
        harness.zone().props.onDragOver(over);
        assert.equal(over.dataTransfer.dropEffect, 'copy'); assert.equal(over.stopped, true);
        const text = dragEvent({ types: ['text/plain'] });
        harness.zone().props.onDragEnter(text);
        harness.zone().props.onDragOver(text);
        assert.equal(text.dataTransfer.dropEffect, 'none');
        assert.equal(harness.zone().props['data-drag-active'], undefined);
    } finally { harness.cleanup(); }
});

test('本地多图拖入追加，上传途中再拖入不会丢文件；非图片和坏图片不阻碍其他图片', async () => {
    let resume;
    const pending = new Promise(resolve => { resume = resolve; });
    const harness = dropHarness({ uploadImage: async file => {
        if (file.name === 'one.png') await pending;
        if (file.name === 'bad.png') throw Error('图片损坏');
        return { storageKey: `image:${file.name}` };
    } });
    try {
        const firstDrop = dragEvent({ files: [{ name: 'one.png', type: 'image/png' }, { name: 'notes.txt', type: 'text/plain' }] });
        harness.zone().props.onDrop(firstDrop);
        assert.equal(firstDrop.prevented, true); assert.equal(firstDrop.stopped, true);
        await settleUploads();
        harness.zone().props.onDrop(dragEvent({ files: [{ name: 'bad.png' }, { name: 'two.HEIC', type: '' }] }));
        resume();
        await settleUploads();
        assert.deepEqual(harness.read().metadata.productMainImages.map(image => image.storageKey),
            ['image:original', 'image:one.png', 'image:two.HEIC']);
        assert.deepEqual(harness.uploads.map(([file]) => file.name), ['one.png', 'bad.png', 'two.HEIC']);
        assert.equal(harness.uploads[0][1].assetProjectId, 'product');
        assert.match(harness.error(), /notes.txt：请选择图片文件/);
        assert.match(harness.error(), /bad.png：图片损坏/);
        assert.equal(harness.zone().props['data-drag-active'], undefined);
    } finally { resume(); harness.cleanup(); }
});

test('左侧图片资产直接复用原图，无重复上传或重复主图；跨产品、失效和非图片资产明确报错', () => {
    const asset = { id: 'asset', kind: 'image', title: '侧面.png', metadata: { projectId: 'product' },
        data: { storageKey: 'image:side', originalStorageKey: 'image:side-native', dataUrl: 'blob:side', width: 900, height: 1200 } };
    const video = { id: 'video', kind: 'video', metadata: { projectId: 'product' }, data: {} };
    const foreign = { ...asset, id: 'foreign', metadata: { projectId: 'other' } };
    const harness = dropHarness({ assets: [asset, video, foreign] });
    const eventFor = (id, productId = 'product') => dragEvent({
        data: { [assetRules.ASSET_DRAG_TYPE]: assetRules.assetDragData(id, productId) },
    });
    try {
        const event = eventFor('asset');
        harness.zone().props.onDrop(event);
        harness.zone().props.onDrop(eventFor('asset'));
        const images = harness.read().metadata.productMainImages;
        assert.equal(images.length, 2);
        assert.equal(images[1].storageKey, asset.data.storageKey);
        assert.equal(images[1].originalStorageKey, asset.data.originalStorageKey);
        assert.equal(images[1].url, asset.data.dataUrl);
        assert.equal(images[1].width, 900); assert.equal(images[1].name, asset.title);
        assert.equal(harness.uploads.length, 0); assert.equal(event.stopped, true);
        harness.zone().props.onDrop(eventFor('video')); assert.match(harness.error(), /仅支持图片/);
        for (const rejected of [eventFor('missing'), eventFor('foreign'), eventFor('asset', 'other')]) {
            harness.zone().props.onDrop(rejected);
            assert.match(harness.error(), /已移除或属于其他产品/);
            assert.equal(harness.read().metadata.productMainImages.length, 2);
        }
        harness.zone().props.onDrop(dragEvent({ types: ['text/uri-list'] }));
        assert.match(harness.error(), /本地图片文件或左侧图片资产/);
    } finally { harness.cleanup(); }
});

test('离开参数卡后中止拖入批次，迟到图片不回写，后续文件不再上传', async () => {
    let resume;
    const pending = new Promise(resolve => { resume = resolve; });
    const harness = dropHarness({ uploadImage: async file => { await pending; return { storageKey: `image:${file.name}` }; } });
    harness.zone().props.onDrop(dragEvent({ files: [{ name: 'one.png' }, { name: 'two.png' }] }));
    await settleUploads();
    harness.cleanup(); resume();
    await settleUploads();
    assert.equal(harness.uploads.length, 1);
    assert.equal(harness.uploads[0][1].signal.aborted, true);
    assert.deepEqual(harness.read().metadata.productMainImages, [original]);
});
