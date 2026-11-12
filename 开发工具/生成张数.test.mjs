import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';

const loader = variantModules({ '@/lib/canvas/node-registry': { getNodeDefinition: type => type === 'guan:product-prompt'
    ? { resource: () => ({ kind: 'text', text: '' }) } : undefined } }), counts = loader.load('画布生成/生成张数规则.ts');
const generation = loader.load('画布生成/产品变体生成.ts');
function fixture() {
    const f = variantFixture(); f.config.metadata.count = 1; return f;
}
const summary = (f, fallback = '1') => counts.variantImageCount(f.config, f.nodes, f.connections, fallback);
const expected = (f, fallback = '1') => generation.productGenerationImageCount(
    generation.planProductGenerationJobs([f.config], f.nodes, f.connections, 'count-check'), fallback);

test('截图的两个变体每个1张，总数2张；改变张数后显示和真实任务计划一致', () => {
    const f = fixture(), before = structuredClone(f.nodes);
    assert.equal(summary(f).total, 2);
    assert.equal(counts.variantImageCountText(summary(f)), '2 个变体 × 每个 1 张 = 共 2 张');
    for (const count of [1, 2, 3, 10, 15, 99]) {
        f.config.metadata.count = count;
        assert.equal(summary(f).total, expected(f));
        assert.equal(summary(f).perVariant, Math.min(15, count));
    }
    f.config.metadata.count = 1;
    assert.deepEqual(f.nodes, before);
});
test('勾选、取消、独立变体卡和多个配置按真实执行目标统计，不把当前查看页签当生成范围', () => {
    const f = fixture();
    f.parameter.metadata.productVariants[1].enabled = false;
    assert.equal(summary(f).variants.length, 1);
    assert.equal(summary(f).total, expected(f));
    f.parameter.metadata.productVariants[1].enabled = true;
    const prompt = { ...f.text, type: 'guan:product-prompt', metadata: { productImagePrompt: {
        parameterId: f.parameter.id, variantId: 'blue', variants: { blue: {} },
    } } };
    f.nodes = f.nodes.map(node => node.id === f.text.id ? prompt : node);
    assert.deepEqual(summary(f).variants.map(item => item.id), ['blue']);
    f.parameter.metadata.productVariants[1].enabled = false;
    assert.equal(summary(f).total, 0);
    assert.match(summary(f).error, /至少勾选/);
});
test('普通卡不增加变体说明，全局默认与节点数量回退和执行一致', () => {
    const f = fixture();
    f.config.metadata.count = undefined;
    assert.equal(summary(f, '3').total, expected(f, '3'));
    assert.equal(summary(f, '3').total, 6);
    f.parameter.metadata.productVariants = [];
    assert.equal(summary(f), undefined);
    f.config.metadata.generationMode = 'text';
    assert.equal(summary(f), undefined);
});
test('合并旧卡的不同张数明确显示真实合计，选择相同基础值也统一所有变体，其他旧配置保留', () => {
    const f = fixture();
    f.config.metadata.productPromptVariantConfigs = { base: { count: 1, quality: 'auto' },
        variants: { red: { count: 3, quality: 'high' }, blue: { count: 2, quality: 'low' } } };
    const original = structuredClone(f.config.metadata);
    assert.equal(summary(f).perVariant, null);
    assert.equal(summary(f).total, expected(f));
    assert.equal(summary(f).total, 5);
    assert.match(counts.variantImageCountText(summary(f)), /各变体张数不同/);
    const patch = counts.sharedImageCountPatch(f.config, { count: 1 });
    assert.deepEqual(f.config.metadata, original);
    f.config.metadata = { ...f.config.metadata, ...patch };
    assert.equal(summary(f).total, 2);
    assert.equal(summary(f).total, expected(f));
    assert.equal(f.config.metadata.productPromptVariantConfigs.variants.red.quality, 'high');
    assert.equal(f.config.metadata.productPromptVariantConfigs.variants.blue.quality, 'low');
    assert.equal(counts.sharedImageCountPatch(f.config, patch), patch);
});
test('显式组装范围、已移除变体与跨产品冲突不会显示虚假的可生成总数', () => {
    const f = fixture();
    f.config.metadata.composerContent = '只有自己的文本';
    assert.equal(summary(f), undefined);
    f.config.metadata.composerContent = undefined;
    f.nodes.push({ ...f.parameter, id: 'other' });
    f.connections.push({ fromNodeId: 'other', toNodeId: f.config.id });
    assert.equal(summary(f).total, 0);
    assert.match(summary(f).error, /一张产品参数卡/);
});

test('实际设置浮层把选项解释为每变体张数，紧凑入口及摘要均包含真实总数', () => {
    const jsx = (type, props) => ({ type, props }), f = fixture();
    const theme = { node: { fill: '#eee', text: '#111' } };
    const ui = variantModules({
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { Settings2: 'Settings' },
        antd: { Button: 'Button' }, 'react-i18next': { useTranslation: () => ({ t: (_key, data) => `${data?.count || ''}张` }) },
        '@/components/image-settings-panel': { ImageSettingsPanel: 'SettingsPanel', imageQualityLabel: () => '自动', imageSizeLabel: () => '2k · 3:4' },
        '@/lib/canvas-theme': { canvasThemes: { light: theme } }, '@/stores/use-theme-store': { useThemeStore: selector => selector({ theme: 'light' }) },
        '@/扩展功能/主题/原生设置浮层': { NativeSettingsPopover: 'Popover' },
        '@/扩展功能/画布生成/生成张数摘要': { VariantImageCountSummary: 'CountSummary' },
    }).load('components/canvas/canvas-image-settings-popover.tsx', true);
    const tree = ui.CanvasImageSettingsPopover({ config: { count: '1' }, imageCountSummary: summary(f), onConfigChange() {} });
    const settings = tree.props.content;
    assert.equal(settings.props.countTitle, '每个变体生成张数');
    assert.equal(settings.props.config.count, '1');
    assert.equal(settings.props.countSummary.props.summary.total, 2);
    assert.match(tree.props.children.props.children.props.children, /共 2 张/);
    f.config.metadata.productPromptVariantConfigs = { base: { count: 1 }, variants: { red: { count: 3 } } };
    const mixed = ui.CanvasImageSettingsPopover({ config: { count: '1' }, imageCountSummary: summary(f), onConfigChange() {} });
    assert.equal(mixed.props.content.props.mixedCount, true);
    const ordinary = ui.CanvasImageSettingsPopover({ config: { count: '1' }, onConfigChange() {} });
    assert.equal(ordinary.props.content.props.countTitle, undefined);
    assert.equal(ordinary.props.content.props.countSummary, null);
});
