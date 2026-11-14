import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { serializeDocument } from '../扩展功能/本机存储/协议.mjs';
import { buildFragmentPlan } from '../扩展功能/本机存储/分片值编码.mjs';

function harness(overrides = {}) {
    let sequence = 0;
    const loader = variantModules({
        nanoid: { nanoid: () => `shared-${++sequence}` },
        '@/lib/canvas/node-registry': { isRegisteredNodeType: () => true, getNodeSpec: () => ({ metadata: {} }),
            getNodeDefinition: type => type === 'guan:product-prompt' ? { resource: () => ({ kind: 'text', text: '' }) } : undefined },
        ...overrides,
    });
    const fixture = variantFixture();
    fixture.nodes = [fixture.parameter]; fixture.connections = [];
    const rules = loader.load('Excel画布/商品提示词规则.ts');
    const canvas = loader.load('Excel画布/商品提示词画布.ts');
    const applyOps = loader.load('lib/canvas/canvas-agent-ops.ts', true).applyCanvasAgentOps;
    const bilingual = id => ({ chinese: `拍摄${id}对应的商品，保留真实形状、材质与数量。`,
        english: `Photograph the actual ${id} product from its own reference photo. Preserve the exact shape, material and included contents.`,
        translatedChinese: `拍摄${id}对应的商品，保留真实形状、材质与数量。` });
    const plan = { overview: { buyers: '', sellingPoints: '', concerns: '', consistency: '', sequence: '' },
        style: '', assumptions: [], pendingFacts: [], images: Array.from({ length: 17 }, (_, i) => ({
            key: `purpose-${i}`, kind: i === 0 ? 'main' : i < 11 ? 'carousel' : 'rich', name: `用途${i}`,
            buyerQuestion: '', evidence: '', composition: '', constraints: '', copyLayout: '', checks: '',
            delivery: i < 11 ? { width: 1800, height: 2400, format: 'png', maxMB: 10 }
                : { width: 800, height: 500, format: 'png', maxMB: 5 },
            prompt: bilingual('shared'), variants: { red: bilingual('red'), blue: bilingual('blue') },
        })) };
    const apply = ops => {
        const next = applyOps({ ...fixture, projectId: 'product', title: '测试', selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }, ops);
        fixture.nodes = next.nodes; fixture.connections = next.connections;
        fixture.parameter = fixture.nodes.find(node => node.id === fixture.parameter.id);
    };
    const fingerprint = rules.planningFingerprint(fixture.parameter.metadata);
    return { loader, fixture, rules, canvas, plan, apply, fingerprint };
}

test('17个用途共用17张提示词及配置，两个变体生成34个独立任务，形成两列17行且仅使用各自照片文案', () => {
    const h = harness(), { fixture, loader, rules } = h;
    h.apply(h.canvas.productPlanOps(fixture.parameter, h.plan, fixture.nodes, fixture.connections, h.fingerprint));
    const prompts = fixture.nodes.filter(node => rules.promptDocument(node)), configs = fixture.nodes.filter(node => node.type === 'config');
    assert.equal(prompts.length, 17); assert.equal(configs.length, 17); assert.equal(fixture.nodes.length, 35);
    assert.equal(fixture.parameter.metadata.productImagePlan.imageCount, 17);
    const generation = loader.load('画布生成/产品变体生成.ts'), context = loader.load('画布生成/商品提示词生成.ts');
    const jobs = generation.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'batch');
    assert.equal(jobs.length, 34); assert.equal(generation.productGenerationImageCount(jobs, '1'), 34);
    const columns = [];
    for (const id of ['red', 'blue']) {
        const selected = jobs.filter(job => job.placement.productVariant.snapshot.id === id);
        assert.equal(selected.length, 17);
        assert.equal(new Set(selected.map(job => job.placement.columnX)).size, 1);
        columns.push(selected[0].placement.columnX);
        for (const job of selected) {
            const built = context.buildProductGenerationContext(job.source.id, fixture.nodes, fixture.connections, '', job.placement.productVariant);
            assert.match(built.prompt, new RegExp(`actual ${id} product`));
            assert.doesNotMatch(built.prompt, new RegExp(`actual ${id === 'red' ? 'blue' : 'red'} product`));
            assert.deepEqual(built.referenceImages.map(image => image.id), [id, 'shared']);
        }
    }
    assert.ok(columns[1] > columns[0] + 340);
    assert.deepEqual(jobs.slice(0, 17).map(job => job.placement.centerY), jobs.slice(17).map(job => job.placement.centerY));
    assert.equal(generation.planProductGenerationJobs([configs[0]], fixture.nodes, fixture.connections, 'single').length, 2);
    fixture.parameter.metadata.productVariants[1].enabled = false;
    assert.equal(generation.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'partial').length, 17);
});

function splitFixture(h) {
    const { fixture, plan } = h;
    for (const [i, brief] of plan.images.entries()) for (const [index, id] of ['red', 'blue'].entries()) {
        const sourceId = `old-prompt-${i}-${id}`, configId = `old-config-${i}-${id}`;
        fixture.nodes.push({ id: sourceId, type: 'guan:product-prompt', title: `${id} · ${brief.name}`, width: 440, height: 540,
            position: { x: 500, y: (i * 2 + index) * 588 }, metadata: { status: 'success',
                productPromptSourceFingerprint: h.fingerprint,
                productImagePrompt: { ...structuredClone(brief), parameterId: fixture.parameter.id, generatedSignature: 'before',
                    name: `${id} · ${brief.name}`, planName: brief.name, variantName: id, variantId: id,
                    prompt: structuredClone(brief.variants[id]), variants: { [id]: structuredClone(brief.variants[id]) } } } },
        { id: configId, type: 'config', title: `${id} · ${brief.name} · 生图`, width: 340, height: 240,
            position: { x: 1036, y: (i * 2 + index) * 588 + 150 },
            metadata: { status: 'success', generationMode: 'image', count: 1, model: 'user-model', size: '1800x2400',
                quality: id === 'blue' ? 'high' : 'low', productPromptConfigKey: sourceId } });
        fixture.connections.push({ id: `parameter-${sourceId}`, fromNodeId: fixture.parameter.id, toNodeId: sourceId },
            { id: `prompt-${configId}`, fromNodeId: sourceId, toNodeId: configId });
    }
}

test('已有34张变体提示词无AI调用合并成17张，保留手改文本、差异配置、已有图片及连线，重复加载不再写入', async () => {
    const h = harness(), { fixture } = h;
    splitFixture(h);
    fixture.nodes.find(node => node.id === 'old-prompt-0-blue').metadata.productImagePrompt.variants.blue.chinese += ' 用户手改';
    const output = { id: 'paid-result', type: 'image', title: '蓝色-1', position: { x: 1600, y: 900 }, width: 340, height: 340,
        metadata: { storageKey: 'image:paid-result', status: 'success', generationParamsSourceNodeId: 'old-config-0-blue',
            productVariant: { parameterId: fixture.parameter.id, id: 'blue', name: '蓝色', attributes: {} } } };
    fixture.nodes.push(output);
    fixture.connections.push({ id: 'paid-edge', fromNodeId: 'old-config-0-blue', toNodeId: output.id });
    fixture.parameter.metadata.productImagePlan = { ...h.plan, images: undefined, imageCount: 34 };
    const before = structuredClone({ nodes: fixture.nodes, connections: fixture.connections });
    h.apply(h.canvas.mergeLegacyProductPrompts(fixture.parameter, fixture.nodes, fixture.connections));
    const prompts = fixture.nodes.filter(node => h.rules.promptDocument(node)), configs = fixture.nodes.filter(node => node.type === 'config');
    assert.equal(prompts.length, 17); assert.equal(configs.length, 17); assert.equal(fixture.parameter.metadata.productImagePlan.imageCount, 17);
    assert.match(h.rules.promptDocument(prompts[0]).variants.blue.chinese, /用户手改/);
    assert.equal(h.rules.promptDocument(prompts[0]).variantId, undefined);
    assert.equal(prompts[0].metadata.productPromptSourceFingerprint, before.nodes[1].metadata.productPromptSourceFingerprint);
    assert.equal(JSON.parse(prompts[0].metadata.productPromptMergeArchive).nodes.length, 4);
    const preserved = fixture.nodes.find(node => node.id === output.id);
    assert.equal(preserved.metadata.storageKey, output.metadata.storageKey);
    assert.deepEqual([preserved.id, preserved.position, preserved.width, preserved.height], [output.id, output.position, output.width, output.height]);
    assert.equal(preserved.metadata.generationParamsSourceNodeId, configs[0].id);
    assert.ok(fixture.connections.some(edge => edge.fromNodeId === configs[0].id && edge.toNodeId === output.id));
    const shared = h.loader.load('Excel画布/共用商品提示词.ts');
    assert.equal(shared.productVariantConfigNode(configs[0], 'blue').metadata.quality, 'high');
    configs[0].metadata.quality = 'medium';
    assert.equal(shared.productVariantConfigNode(configs[0], 'blue').metadata.quality, 'medium');
    assert.deepEqual(h.canvas.mergeLegacyProductPrompts(fixture.parameter, fixture.nodes, fixture.connections), []);
    const codec = createValueCodec({ client: {} });
    const value = { nodes: fixture.nodes, connections: fixture.connections };
    const encoded = await codec.encode(value);
    serializeDocument('extension', 'shared-prompts', { tree: encoded.tree }, encoded.mediaIds);
    assert.deepEqual(await codec.decode(encoded.tree), value, '合并后的文案、配置与归档可完整持久化恢复');
    const application = { state: { projects: [{ id: 'project', ...value }], deletedProjects: [], guanWorkbooks: null }, version: 0 };
    const full = await codec.encode(application);
    const namespace = await buildFragmentPlan([['infinite-canvas:canvas_store', full]]);
    assert.ok(namespace.fragments.size > 0, '包含项目外壳和命名空间的真实类型树也能完成文档准备');
    codec.close();
});

test('仍有生成任务时保留原卡，完成后才允许合并；旧共用卡不再展开', () => {
    const h = harness();
    h.plan.images = h.plan.images.slice(0, 1); splitFixture(h);
    h.fixture.nodes.find(node => node.type === 'config').metadata.status = 'loading';
    assert.deepEqual(h.canvas.mergeLegacyProductPrompts(h.fixture.parameter, h.fixture.nodes, h.fixture.connections), []);
    h.fixture.nodes.find(node => node.type === 'config').metadata.status = 'success';
    h.apply(h.canvas.mergeLegacyProductPrompts(h.fixture.parameter, h.fixture.nodes, h.fixture.connections));
    assert.equal(h.fixture.nodes.length, 3);
});

test('卡内切换变体不保存或生成，编辑与AI优化仅改变所选变体，另一变体保持原文', () => {
    const cells = [], effects = [];
    let cursor = 0, updates = 0;
    const h = harness({
        react: { useEffect: fn => effects.push(fn), useRef: value => ({ current: value }), useMemo: fn => fn(),
            useState: value => { const index = cursor++; if (!(index in cells)) cells[index] = typeof value === 'function' ? value() : value;
                return [cells[index], next => { cells[index] = next; }]; } },
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
        'lucide-react': { Languages: 'Languages', RotateCcw: 'RotateCcw' },
        antd: { Segmented: 'Segmented' }, '../主题/页签内容过渡': { TabContentTransition: 'TabContentTransition' },
        './提示词变体选择': { PromptVariantTabs: 'VariantTabs', PromptVariantSelectAll: 'SelectAll' },
        './Excel画布上下文': { useExcelProductId: () => 'product' }, './商品策划请求': {},
        '../提示词/双语联动文本框': { useBilingualPromptSync: () => ({}), BilingualPromptField: 'Field' },
        './商品待确认编辑': { ProductConfirmationDialog: 'ProductConfirmationDialog' },
        './图片引用标签': { ImageReferenceText:'ImageReferenceText', ImageReferenceToken:'ImageReferenceToken' },
    });
    h.apply(h.canvas.productPlanOps(h.fixture.parameter, h.plan, h.fixture.nodes, h.fixture.connections, h.fingerprint));
    const node = h.fixture.nodes.find(item => h.rules.promptDocument(item)), original = structuredClone(h.rules.promptDocument(node).variants.red);
    const ctx = { node, theme: { node: {} }, getNode: id => h.fixture.nodes.find(item => item.id === id), getConnections: () => h.fixture.connections,
        updateMetadata: patch => { updates++; node.metadata = { ...node.metadata, ...patch }; } };
    const render = () => {
        cursor = 0;
        const tree = h.loader.load('Excel画布/商品提示词卡片.tsx').ProductPromptContent({ ctx });
        const flat = item => item && typeof item === 'object' ? [item, ...[item.props?.children].flat(Infinity).flatMap(flat)] : [];
        return flat(tree);
    };
    let tree = render();
    const selector = tree.find(item => item.type === 'VariantTabs');
    assert.deepEqual(selector.props.ids, ['red', 'blue']);
    selector.props.onChange('blue'); tree = render();
    assert.equal(updates, 0);
    assert.match(tree.find(item => item.type === 'Field' && item.props.language === 'chinese').props.value, /blue|蓝色__正面/);
    const optimization = h.loader.load('提示词/提示词优化规则.ts');
    const source = optimization.readPromptOptimizationSource(node, h.fixture.nodes);
    assert.equal(source.context.image.variantId, 'blue');
    h.apply(optimization.promptOptimizationOps(source, { chinese: source.chinese + ' 优化', english: source.english + ' Use soft daylight.', changes: [] }, h.fixture.nodes));
    const updated = h.rules.promptDocument(h.fixture.nodes.find(item => item.id === node.id));
    assert.deepEqual(updated.variants.red, original);
    assert.match(updated.variants.blue.chinese, /优化/);
});

test('整理后的结果仍以变体为两列，缺失一张结果也不将另一套混到第一列', () => {
    const h = harness(), { fixture } = h;
    h.plan.images = h.plan.images.slice(0, 2);
    h.apply(h.canvas.productPlanOps(fixture.parameter, h.plan, fixture.nodes, fixture.connections, h.fingerprint));
    const configs = fixture.nodes.filter(node => node.type === 'config');
    for (const [index, config] of configs.entries()) for (const [col, id] of ['red', 'blue'].entries()) {
        if (index === 1 && id === 'red') continue;
        const width = index ? 200 : 340;
        const result = { id: `result-${index}-${id}`, type: 'image', title: `${id}-${index + 1}`, width, height: width * (index ? 5 / 8 : 4 / 3),
            position: { x: 2040 - col * 440 + index * 20, y: index * 588 }, metadata: {
                naturalWidth: index ? 800 : 1800, naturalHeight: index ? 500 : 2400,
                generationBatchId: 'batch', productVariant: { parameterId: fixture.parameter.id, id, name: id, attributes: {} } } };
        fixture.nodes.push(result); fixture.connections.push({ id: result.id, fromNodeId: config.id, toNodeId: result.id });
    }
    const next = h.loader.load('画布布局/画布整体排布.ts').layoutCanvas(fixture.nodes, fixture.connections);
    assert.equal(next.find(node => node.id === 'result-0-blue').position.x, next.find(node => node.id === 'result-1-blue').position.x);
    assert.ok(next.find(node => node.id === 'result-0-blue').position.x > next.find(node => node.id === 'result-0-red').position.x);
    assert.equal(next.find(node => node.id === 'result-0-blue').width, next.find(node => node.id === 'result-1-blue').width);
    assert.equal(next.find(node => node.id === 'result-1-blue').height / next.find(node => node.id === 'result-1-blue').width, 5 / 8);
    assert.deepEqual(h.loader.load('画布布局/画布整体排布.ts').layoutCanvas(next, fixture.connections), next);
});

test('按主图、轮播、富内容排列，类内遵守AI原规划，标题、完成先后和旧坐标不改变顺序', async () => {
    const h = harness(), { fixture } = h;
    const definitions = [
        ['rich', '主图对照'], ['carousel', '最后才会按字母排序的主题'],
        ['main', '节日主视觉'], ['rich', '包装说明'],
        ['carousel', '数量套装'], ['carousel', '正面核款'],
    ];
    h.plan.images = definitions.map(([kind, name], i) => ({ ...h.plan.images[i], kind, name }));
    const originalPlan = structuredClone(h.plan);
    h.apply(h.canvas.productPlanOps(fixture.parameter, h.plan, fixture.nodes, fixture.connections, h.fingerprint));
    assert.deepEqual(h.plan, originalPlan, '排布不改动AI规划和文案');
    const expected = [2, 1, 4, 5, 0, 3].map(i => `purpose-${i}`);
    const prompts = fixture.nodes.filter(node => h.rules.promptDocument(node));
    assert.deepEqual(prompts.map(node => h.rules.promptDocument(node).key), expected, '新卡片初始就按用途分区');
    for (const prompt of prompts) {
        const doc = h.rules.promptDocument(prompt);
        assert.equal(doc.planIndex, Number(doc.key.split('-')[1]));
        const config = fixture.nodes.find(node => node.metadata?.productPromptConfigKey === prompt.id);
        for (const [col, id] of ['red', 'blue'].entries()) {
            const result = { id: `${doc.key}-${id}`, type: 'image', title: `乱序完成-${20 - doc.planIndex}`,
                width: 340, height: 340, position: { x: 1900 - col * 440, y: (5 - doc.planIndex) * 900 },
                metadata: { storageKey: `image:${doc.key}-${id}`, generationBatchId: 'batch',
                    productVariant: { parameterId: fixture.parameter.id, id, name: id, attributes: {} } } };
            fixture.nodes.push(result);
            fixture.connections.push({ id: result.id, fromNodeId: config.id, toNodeId: result.id });
        }
    }
    const layout = h.loader.load('画布布局/画布整体排布.ts').layoutCanvas;
    const assertOrder = next => {
        const sorted = next.filter(node => h.rules.promptDocument(node)).sort((a, b) => a.position.y - b.position.y);
        assert.deepEqual(sorted.map(node => h.rules.promptDocument(node).key), expected);
        for (const prompt of sorted) {
            const key = h.rules.promptDocument(prompt).key, middle = prompt.position.y + prompt.height / 2;
            const config = next.find(node => node.metadata?.productPromptConfigKey === prompt.id);
            assert.equal(config.position.y + config.height / 2, middle);
            for (const id of ['red', 'blue']) {
                const result = next.find(node => node.id === `${key}-${id}`);
                assert.equal(result.position.y + result.height / 2, middle, '提示词、配置和两套结果保持同行');
                assert.equal(result.metadata.storageKey, `image:${key}-${id}`);
            }
        }
    };
    const before = structuredClone({ nodes: fixture.nodes, connections: fixture.connections }), next = layout(fixture.nodes, fixture.connections);
    assertOrder(next);
    const reversed = layout([...fixture.nodes].reverse(), [...fixture.connections].reverse());
    assertOrder(reversed);
    assert.deepEqual(Object.fromEntries(next.map(node => [node.id, node.position])),
        Object.fromEntries(reversed.map(node => [node.id, node.position])), '已有规划序号不依赖节点输入顺序');
    assert.deepEqual({ nodes: fixture.nodes, connections: fixture.connections }, before);
    assert.deepEqual(layout(next, fixture.connections), next);
    const codec = createValueCodec({ client: {} });
    try {
        const encoded = await codec.encode({ nodes: next, connections: fixture.connections });
        const restored = await codec.decode(encoded.tree);
        assertOrder(layout(restored.nodes, restored.connections));
    } finally { codec.close(); }
});

test('已有无规划序号的套图使用原始创建顺序，拖动或整理过的坐标不会代替规划顺序', () => {
    const h = harness(), { fixture } = h;
    h.apply(h.canvas.productPlanOps(fixture.parameter, h.plan, fixture.nodes, fixture.connections, h.fingerprint));
    const expected = h.plan.images.map(image => image.key);
    for (const [index, node] of fixture.nodes.entries()) {
        if (h.rules.promptDocument(node)) delete node.metadata.productImagePrompt.planIndex;
        node.position = { ...node.position, y: (fixture.nodes.length - index) * 600 };
    }
    const layout = h.loader.load('画布布局/画布整体排布.ts').layoutCanvas;
    const next = layout(fixture.nodes, fixture.connections);
    assert.deepEqual(next.filter(node => h.rules.promptDocument(node)).sort((a, b) => a.position.y - b.position.y)
        .map(node => h.rules.promptDocument(node).key), expected);
    assert.deepEqual(layout(next, fixture.connections), next);
});

test('分配图片面板使用统一主按钮，完成文字不继承画布里的深色文本样式', () => {
    const h = harness({
        react: { useState: value => [value, () => {}] },
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
        antd: { Button: 'Button', Checkbox: 'Checkbox', Tooltip: 'Tooltip' },
        'motion/react': { AnimatePresence: 'Presence' },
        './变体管理面板': { ProductVariantManager: 'Manager' },
        'lucide-react': Object.fromEntries(['Check', 'ChevronDown', 'Copy', 'Images', 'Plus', 'Trash2', 'X'].map(key => [key, key])),
        '../主题/苹果弹窗': { AppleModal: 'Modal' }, '../媒体交付/媒体缩略图': { MediaThumbnail: 'MediaThumbnail' },
        './参数图片预览': { ParameterImageThumbnail: 'ParameterImageThumbnail' },
    });
    const tree = h.loader.load('Excel画布/产品变体编辑.tsx').ProductVariantEditor({
        ctx: { node: h.fixture.parameter, theme: { node: {} }, getNode: () => h.fixture.parameter,
            getNodes: () => h.fixture.nodes, getConnections: () => h.fixture.connections }, onChange() {}, tokens: [],
    });
    const flat = item => item && typeof item === 'object' ? [item, ...[item.props?.children].flat(Infinity).flatMap(flat)] : [];
    const done = flat(tree).find(item => item.type === 'Button' && item.props.children === '完成');
    assert.equal(done.props.type, 'primary');
});
