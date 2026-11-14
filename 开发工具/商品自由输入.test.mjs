import test from 'node:test';
import assert from 'node:assert/strict';
import { variantFixture, variantModules } from './产品变体生成夹具.mjs';

const description = '白色三层带轮置物架，72×36×23cm，只销售空架、不含摆件。主图简洁，尺寸图展示尺寸。MAIN_INPUT_ONLY';
function fixture(overrides = {}) {
    let sequence = 0, loader;
    loader = variantModules({
        nanoid: { nanoid: () => `freeform-${++sequence}` },
        '@/lib/canvas/node-registry': { getNodeDefinition: type => type === 'guan:product-prompt'
            ? { resource: () => ({ kind: 'text', text: '' }) } : undefined },
        ...overrides,
    });
    const data = variantFixture();
    Object.assign(data.parameter.metadata, { productPlatform: '未指定', productBrief: {}, promptVariableValues: {},
        promptVariableSupplement: description, productVariants: undefined, productSharedImageIds: undefined });
    data.nodes = [data.parameter]; data.connections = [];
    return { loader, data, rules: loader.load('Excel画布/商品提示词规则.ts') };
}
const pair = text => ({ chinese: `展示真实商品，保留原有结构与颜色。${text}`,
    english: `Show the real product while preserving its actual structure and color. ${text}` });
const plan = () => ({ overview: { buyers: '收纳用户', sellingPoints: '窄缝收纳', concerns: '实际销售内容', consistency: '按实物', sequence: '整体后尺寸' },
    style: '真实摄影', assumptions: [], pendingFacts: [], images: ['main', 'carousel'].map((kind, index) => ({
        key: index ? 'dimension' : 'main', kind, name: index ? '尺寸图' : '主图', buyerQuestion: '收到什么商品',
        evidence: '实物与用户资料', composition: '完整商品与柔光', constraints: '保留层数和轮子', copyLayout: '本图文字', checks: '检查实际图片',
        delivery: { width: 1024, height: 1024, format: 'png', maxMB: 10 }, prompt: pair(index ? 'DIMENSION_IMAGE' : 'MAIN_IMAGE'), variants: {},
    })) });
test('整套策划先展示待确认，保留真实编辑组件；无待确认时不显示空分区', () => {
    const jsx = (type, props) => ({ type, props });
    const loader = variantModules({
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'lucide-react': {},
        '../主题/苹果交互按钮': {}, '../主题/任务阶段反馈': {},
        './商品待确认编辑': { ProductConfirmationList: 'ConfirmationList' },
        './商品策划流式预览': {},
        './图片引用标签规则': { imageReferenceCatalog: () => [] },
        './图片引用标签': { ImageReferenceText: 'ReferenceText' },
        './商品策划恢复入口': {}, './商品策划副本规则': {},
        './策划自动保存': {},
    });
    const render = loader.load('Excel画布/商品策划按钮.tsx').ProductPlanOverview;
    const value = { ...plan(), imageCount: 2, preserved: 0 };
    for (const mode of ['pending', 'confirmation', 'none']) {
        value.pendingFacts = mode === 'pending' ? ['数量待确认'] : [];
        value.confirmations = mode === 'confirmation' ? [{ id: 'count' }] : mode === 'pending' ? undefined : [];
        const tree = render({ metadata: { productImagePlan: value }, ctx: {}, productId: 'product' });
        const sections = tree.props.children[1].props.children.flat().filter(Boolean);
        assert.equal(tree.props.open, mode !== 'none');
        assert.equal(sections[0].props.children[0].props.children, mode === 'none' ? '目标买家' : '待确认');
        if (mode !== 'none') assert.equal(sections[0].props.children[1].props.children.type, 'ConfirmationList');
    }
});
function apply(data, ops) {
    for (const op of ops) {
        if (op.type === 'add_node') data.nodes.push({ id: op.id, type: op.nodeType, title: op.title,
            position: op.position, width: op.width, height: op.height, metadata: op.metadata });
        if (op.type === 'update_node') {
            const node = data.nodes.find(node => node.id === op.id);
            Object.assign(node, op.patch); node.metadata = { ...node.metadata, ...op.metadata };
        }
        if (op.type === 'connect_nodes') data.connections.push({ id: `edge-${data.connections.length}`, ...op });
    }
}
test('仅自由输入和产品图即可构造策划事实，旧文字原样保留且不猜测详细字段', () => {
    const { data, rules } = fixture(), before = structuredClone(data.parameter.metadata);
    const facts = rules.productPlanningFacts(data.parameter.metadata);
    assert.equal(facts.supplement, description);
    assert.deepEqual(facts.brief, {});
    assert.equal(facts.images.length, 4);
    assert.deepEqual(data.parameter.metadata, before);
    const restored = JSON.parse(JSON.stringify(data.parameter.metadata));
    assert.equal(rules.productPlanningFacts(restored).supplement, description);
});
test('空白输入和仅待确认依据不代替商品资料；详细商品名、变量及配图校验仍兼容', () => {
    const { data, rules } = fixture(), metadata = data.parameter.metadata;
    for (const text of ['', ' \n ', '【待确认依据：承重】\n10kg\n【/待确认依据：承重】']) {
        metadata.promptVariableSupplement = text;
        assert.throws(() => rules.productPlanningFacts(metadata), /商品资料与制作要求/);
    }
    metadata.productBrief = { nameCategory: '置物架' };
    assert.doesNotThrow(() => rules.productPlanningFacts(metadata));
    metadata.productBrief = {}; metadata.promptVariableValues = { '[NAME]': '置物架' };
    assert.doesNotThrow(() => rules.productPlanningFacts(metadata));
    metadata.promptVariableSupplement = description; metadata.productMainImages = [];
    assert.throws(() => rules.productPlanningFacts(metadata), /上传产品主图/);
});
test('策划按每图正文执行，主输入不整段追加；统一要求仅追加一次，修改清空立即生效', () => {
    const { loader, data, rules } = fixture();
    const parsed = rules.parseProductImagePlan(JSON.stringify(plan()), []);
    apply(data, loader.load('Excel画布/商品提示词画布.ts').productPlanOps(data.parameter, parsed, data.nodes, data.connections,
        rules.planningFingerprint(data.parameter.metadata)));
    const generator = loader.load('画布生成/商品提示词生成.ts');
    const configs = data.nodes.filter(node => node.type === 'config');
    const fingerprint = rules.planningFingerprint(data.parameter.metadata);
    for (const supplement of ['Keep the original logo. GLOBAL_ONLY', 'No watermark. GLOBAL_EDITED', '']) {
        data.parameter.metadata.productGenerationSupplement = supplement;
        assert.equal(rules.planningFingerprint(data.parameter.metadata), fingerprint, '通用追加变化不要求重新策划');
        for (const [index, config] of configs.entries()) {
            const text = generator.buildProductGenerationContext(config.id, data.nodes, data.connections, '').prompt;
            assert.ok(text.includes(index ? 'DIMENSION_IMAGE' : 'MAIN_IMAGE'));
            assert.equal(text.includes(index ? 'MAIN_IMAGE' : 'DIMENSION_IMAGE'), false);
            assert.doesNotMatch(text, /MAIN_INPUT_ONLY/);
            assert.equal(text.split(supplement || 'GLOBAL_').length - 1, supplement ? 1 : 0);
        }
    }
});
test('修改主输入使既有策划失效，源记录保留原文字，统一追加不污染策划事实', () => {
    const { data, rules } = fixture(), original = rules.planningFingerprint(data.parameter.metadata);
    data.parameter.metadata.productGenerationSupplement = '统一追加';
    assert.equal(rules.planningFingerprint(data.parameter.metadata), original);
    assert.doesNotMatch(JSON.stringify(rules.productPlanningFacts(data.parameter.metadata)), /统一追加/);
    data.parameter.metadata.promptVariableSupplement += ' 改为四层。';
    assert.deepEqual(rules.productPlanningChanges(data.parameter.metadata, original), ['商品资料与制作要求']);
    assert.equal(JSON.parse(original)[0].supplement, description);
});
test('同一次真实策划入口传递自由输入、冲突处理和逐图分工，不发送额外提取请求', async () => {
    const requests = [];
    const { loader, data } = fixture({
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({ config: { imageModel: 'image', model: 'text' }, isAiConfigReady: () => true }) } },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: config => config },
        '../产品/产品操作': { saveProductCanvas: async () => ({ persisted: true }) },
        '../画布生成/原画布文本调用': { confirmSavedCanvasText: async () => {}, requestCanvasText: async request => {
            requests.push(request);
            await request.recordTask({ slotId: request.scope.slotId, taskId: 'freeform-task' });
            const response = plan();
            response.protocolVersion = 'product-image-plan.v2';
            response.images.forEach(image => {
                image.prompt = { segments: [image.prompt], designSegments: [pair('本图设计')] };
            });
            response.confirmations = [];
            await request.applyAndSave(JSON.stringify(response), { taskId: 'freeform-task' });
        } },
        './商品策划完成通知': { notifyProductPlanning() {} },
    });
    const ctx = { node: data.parameter, getNode: id => data.nodes.find(node => node.id === id),
        getNodes: () => data.nodes, getConnections: () => data.connections,
        updateMetadata: patch => { data.parameter.metadata = { ...data.parameter.metadata, ...patch }; },
        applyOps: ops => apply(data, ops) };
    await loader.load('Excel画布/商品策划请求.ts').planProductImages(ctx, 'freeform-product', new AbortController().signal);
    assert.equal(requests.length, 1);
    const task = JSON.parse(requests[0].messages[1].content[0].text);
    assert.equal(task.facts.supplement, description);
    assert.deepEqual(task.facts.brief, {});
    assert.match(task.requirements.briefInterpretation, /不增加单独/);
    assert.match(requests[0].messages[0].content, /不把整段资料原样重复/);
    assert.equal(data.nodes.filter(node => node.type === 'config').length, 2);
    assert.deepEqual(data.parameter.metadata.productBrief, {});
});
