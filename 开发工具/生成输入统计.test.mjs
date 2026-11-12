import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';

const fallback = { textCount: 9, imageCount: 99, videoCount: 8, audioCount: 7 };
const loader = variantModules({ '@/lib/canvas/node-registry': { getNodeDefinition: type => type === 'guan:product-prompt'
    ? { resource: () => ({ kind: 'text', text: '' }) } : undefined } });
const rules = loader.load('Excel画布/商品提示词规则.ts'), generation = loader.load('画布生成/产品变体生成.ts');
const input = loader.load('画布生成/商品提示词生成.ts'), display = loader.load('画布生成/生成输入规则.ts');
function fixture() {
    const f = variantFixture();
    f.parameter.metadata.productMainImages = f.parameter.metadata.productMainImages.slice(0, 2);
    f.parameter.metadata.productSharedImageIds = [];
    const chinese = '保留实际商品、外观、颜色和尺寸，完整展示实物。';
    const pair = { chinese, translatedChinese: chinese, english: 'Preserve the actual product appearance, color and dimensions. Show the entire item in soft daylight.' };
    f.text = { ...f.text, type: 'guan:product-prompt', metadata: { productImagePrompt: {
        parameterId: f.parameter.id, key: 'main', kind: 'main', name: '主图', generatedSignature: '',
        prompt: structuredClone(pair), variants: { red: structuredClone(pair), blue: structuredClone(pair) },
        delivery: { width: 1800, height: 2400, format: 'png', maxMB: 10 },
    } } };
    f.nodes = [f.parameter, f.text, f.config];
    f.refresh = () => { f.text.metadata.productPromptSourceFingerprint = rules.planningFingerprint(f.parameter.metadata); };
    f.refresh();
    return f;
}
function summary(f) { return input.productPromptInputSummary(f.config.id, f.nodes, f.connections, fallback); }
function assertMatchesRequests(f, result) {
    f.refresh();
    const jobs = generation.planProductGenerationJobs([f.config], f.nodes, f.connections, 'inputs-check');
    assert.equal(result.variants.length, jobs.length);
    for (const job of jobs) {
        const context = input.buildProductGenerationContext(f.config.id, f.nodes, f.connections,
            f.config.metadata.composerContent || f.config.metadata.prompt || '', job.placement.productVariant);
        const item = result.variants.find(value => value.id === job.placement.productVariant.snapshot.id);
        for (const key of ['textCount', 'imageCount', 'videoCount', 'audioCount']) assert.equal(item[key], context[key], key);
        assert.deepEqual(item.images, context.referenceImages.map(image => image.name));
    }
}
test('截图两变体各用一张独有图，显示每变体1张，不合并为2张也不沿用fallback', () => {
    const f = fixture(), result = summary(f);
    assert.equal(result.imageCount, 1);
    assert.equal(display.generationInputCountLabel(result, 'imageCount'), '1 张/变体');
    assert.equal(display.generationInputCountLabel(result, 'textCount'), '1 个/变体');
    assert.equal(display.generationInputCountLabel(result, 'videoCount'), '0 个');
    assert.equal(display.generationInputCountLabel(result, 'audioCount'), '0 个');
    assert.deepEqual(result.variants.map(item => item.images), [['红色__正面.png'], ['蓝色__正面.png']]);
    assertMatchesRequests(f, result);
    f.config.metadata.count = 5;
    assert.deepEqual(summary(f), result, '输出张数不倍增输入图片数');
});
test('共用图在每个变体中计一次，不同配图数显示范围且可核对逐变体明细', () => {
    const f = fixture();
    f.parameter.metadata.productMainImages.push(f.image('shared', '共用尺寸.png'), f.image('blue-back', '蓝款背面.png'));
    f.parameter.metadata.productSharedImageIds = ['shared', 'shared'];
    f.parameter.metadata.productVariants[1].imageIds.push('blue-back');
    const result = summary(f);
    assert.equal(display.generationInputCountLabel(result, 'imageCount'), '2–3 张/变体');
    assert.match(display.generationInputDetail(result), /红色：提示词 1 个，参考图 2 张/);
    assert.match(display.generationInputDetail(result), /蓝色：提示词 1 个，参考图 3 张/);
    assertMatchesRequests(f, result);
});
test('取消勾选和独立变体卡仅统计执行范围，未分配图片不参与，错误配图不冒充可用数量', () => {
    const f = fixture(); f.parameter.metadata.productMainImages.push(f.image('unused'));
    f.parameter.metadata.productVariants[0].enabled = false;
    assert.deepEqual(summary(f).variants.map(item => item.id), ['blue']);
    f.text.metadata.productImagePrompt.variantId = 'blue';
    f.parameter.metadata.productVariants[0].enabled = true;
    assert.deepEqual(summary(f).variants.map(item => item.id), ['blue']);
    assertMatchesRequests(f, summary(f));
    f.parameter.metadata.productVariants[1].imageIds = ['missing'];
    assert.match(summary(f).error, /移除/);
    assert.equal(display.generationInputCountLabel(summary(f), 'imageCount'), '待核对');
});
test('待确认事项照片只计入关联用途和对应变体，与实际提交图片清单一致', () => {
    const f = fixture(), confirmations = loader.load('Excel画布/商品待确认规则.ts');
    const field = { id: 'packaging', label: '包装实拍', question: '请补充包装实拍', kind: 'image', scope: 'variant',
        scopes: [], unit: '', imageKeys: ['main'], fallback: '仅展示已确认内容' };
    f.parameter.metadata.productImagePlan = { pendingFacts: [], confirmations: [field] };
    for (const id of ['red', 'blue']) Object.assign(f.parameter.metadata,
        confirmations.confirmationAnswerPatch(f.parameter.metadata, field, id, { images: [f.image(`proof-${id}`, `${id}包装.png`)] }));
    f.text.metadata.productImagePrompt.confirmationImageIds = ['proof-red', 'proof-blue'];
    const result = summary(f);
    assert.deepEqual(result.variants.map(item => item.images.at(-1)), ['red包装.png', 'blue包装.png']);
    assertMatchesRequests(f, result);
});
test('额外连入的其他图片不会被算进变体请求，视频音频仍按实际请求计数', () => {
    const f = fixture();
    for (const [type, metadata] of [
        ['image', { content: 'data:image/png;base64,eA==', storageKey: 'other-photo' }],
        ['video', { content: 'https://example.invalid/video.mp4', storageKey: 'video' }],
        ['audio', { content: 'https://example.invalid/audio.mp3', storageKey: 'audio' }],
    ]) {
        const node = { ...f.config, id: type, type, title: type, metadata };
        f.nodes.push(node); f.connections.push({ fromNodeId: node.id, toNodeId: f.config.id });
    }
    assert.equal(summary(f).imageCount, 1);
    assertMatchesRequests(f, summary(f));
});
test('显式组装只统计被引用资源，普通无变体卡也按照真实上下文而不是全部连线统计', () => {
    const f = fixture();
    const extra = { ...f.config, id: 'external', type: 'image', title: '外部图片', metadata: { content: 'data:image/png;base64,eA==', storageKey: 'outside' } };
    f.nodes.push(extra); f.connections.push({ fromNodeId: extra.id, toNodeId: f.config.id });
    f.config.metadata.composerContent = '@[node:prompt]';
    assertMatchesRequests(f, summary(f));
    f.config.metadata.composerContent = '@[node:external]';
    const selected = summary(f), context = input.buildProductGenerationContext(f.config.id, f.nodes, f.connections, f.config.metadata.composerContent);
    assert.equal(selected.variants, undefined);
    assert.equal(selected.textCount, 0);
    assert.equal(selected.imageCount, 1);
    assert.equal(selected.imageCount, context.imageCount);
    f.config.metadata.composerContent = '仅填写自己的提示词';
    assert.deepEqual(summary(f), { textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0 });
});
test('无变体产品图和额外连线图均按ID去重，预览数字与提交相同', () => {
    const f = fixture(); f.parameter.metadata.productVariants = [];
    f.text.metadata.productImagePrompt.variants = {};
    f.nodes.push({ ...f.config, id: 'red', type: 'image', title: '重复参考图', metadata: { content: 'data:image/png;base64,eA==', storageKey: 'stored-red' } });
    f.connections.push({ fromNodeId: 'red', toNodeId: f.config.id }); f.refresh();
    const result = summary(f), actual = input.buildProductGenerationContext(f.config.id, f.nodes, f.connections, '');
    assert.equal(result.variants, undefined);
    assert.equal(result.imageCount, 2);
    assert.equal(result.imageCount, actual.imageCount);
    assert.equal(display.generationInputCountLabel(result, 'imageCount'), '2 张');
});
test('真实统计组件四类输入显示每变体范围，键盘与悬停可查看同一份明细', () => {
    const jsx = (type, props) => ({ type, props }), f = fixture();
    const ui = variantModules({ 'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Tooltip: 'Tooltip' } }).load('画布生成/生成输入统计.tsx');
    const labels = { textCount: '提示词', imageCount: '参考图', videoCount: '参考视频', audioCount: '参考音频' };
    const tree = ui.GenerationInputChips({ summary: summary(f), labels, style: {} });
    assert.equal(tree.props['aria-label'], '生成输入 · 2 个变体分别提交');
    assert.equal(tree.props.children.length, 4);
    const image = tree.props.children[1];
    assert.equal(image.props.children.props['aria-label'], '参考图 1 张/变体');
    assert.equal(image.props.children.props.tabIndex, 0);
    assert.deepEqual(image.props.trigger, ['hover', 'focus']);
    assert.match(image.props.title.props.children, /红色/);
    assert.match(image.props.title.props.children, /蓝色/);
});
