import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { serializeDocument } from '../扩展功能/本机存储/协议.mjs';

const pair = color => ({
    english: `Photograph the actual ${color} travel bag from reference photos, preserving its shape, material, seams and included strap. Use soft daylight and show the complete sale contents.`,
    chinese: `拍摄参考图中的${color}旅行包，保留形状、材质、缝线和随附背带，使用柔和日光，完整展示实际销售内容。`,
});
function planData(variantIds = []) {
    return {
        overview: { buyers: '旅行用户', sellingPoints: '实拍展示', concerns: '数量与结构', consistency: '按实物', sequence: '先整体再细节' },
        style: '柔和自然光', assumptions: [], pendingFacts: [],
        images: ['main', 'rich'].map(kind => ({
            key: kind, kind, name: kind === 'main' ? '主视觉' : '使用说明',
            buyerQuestion: '实际收到什么', evidence: '已提供实物图与包装清单', composition: '正面、柔光、中性背景',
            constraints: '不改变结构或销售数量', copyLayout: '无需叠加文字', checks: '核实真实性并检查导出尺寸、格式及文件大小',
            delivery: kind === 'main' ? { width: 1800, height: 2400, format: 'png', maxMB: 10 }
                : { width: 800, height: 500, format: 'png', maxMB: 5 },
            prompt: pair('red'), variants: Object.fromEntries(variantIds.map(id => [id, pair(id)])),
        })),
    };
}
function modules(overrides = {}) {
    let sequence = 0, loader;
    loader = variantModules({
        nanoid: { nanoid: () => `plan-${++sequence}` },
        '@/lib/canvas/node-registry': { getNodeDefinition: type => type === 'guan:product-prompt'
            ? { resource: () => ({ kind: 'text', text: '' }) }
            : type === 'guan:prompt-variables' ? { resource: node => loader.load('Excel画布/旧版参数规则.ts').promptVariablesResource(node) } : undefined },
        ...overrides,
    });
    return loader;
}
function apply(fixture, ops) {
    for (const op of ops) {
        if (op.type === 'add_node') fixture.nodes.push({ id: op.id, type: op.nodeType, title: op.title,
            position: op.position, width: op.width, height: op.height, metadata: op.metadata });
        if (op.type === 'update_node') {
            const node = fixture.nodes.find(item => item.id === op.id);
            Object.assign(node, op.patch); node.metadata = { ...node.metadata, ...op.metadata };
        }
        if (op.type === 'connect_nodes' && !fixture.connections.some(item => item.fromNodeId === op.fromNodeId && item.toNodeId === op.toNodeId))
            fixture.connections.push({ id: `edge-${fixture.connections.length}`, ...op });
    }
}
function planned(loader = modules()) {
    const fixture = variantFixture();
    fixture.nodes = [fixture.parameter]; fixture.connections = [];
    const rules = loader.load('Excel画布/商品提示词规则.ts');
    const plan = rules.parseProductImagePlan(JSON.stringify(planData(['red', 'blue'])), ['red', 'blue']);
    const canvas = loader.load('Excel画布/商品提示词画布.ts');
    const fingerprint = rules.planningFingerprint(fixture.parameter.metadata);
    apply(fixture, canvas.productPlanOps(fixture.parameter, plan, fixture.nodes, fixture.connections, fingerprint));
    return { loader, fixture, rules, plan, canvas, fingerprint };
}

test('通用角色不含平台规格，策划只使用所选平台规则，删除字段的旧值不再影响AI', () => {
    const loader = modules(), { PRODUCT_PLANNING_ROLE } = loader.load('Excel画布/商品视觉策划指令.ts');
    assert.doesNotMatch(PRODUCT_PLANNING_ROLE, /Wildberries|1800|2400|800|500|sunburst/);
    assert.match(PRODUCT_PLANNING_ROLE, /每张提示词必须能够独立执行/);
    const rules = loader.load('Excel画布/商品提示词规则.ts');
    const task = loader.load('Excel画布/商品策划任务规则.ts');
    const platformRules = loader.load('Excel画布/旧版参数规则.ts');
    const { parameter } = variantFixture();
    const fingerprint = rules.planningFingerprint(parameter.metadata);
    parameter.metadata.productBrief.carouselCount = '99';
    parameter.metadata.productBrief.generationTool = '旧工具';
    parameter.metadata.productVariants[0].brief = { generationTool: '旧变体工具' };
    parameter.metadata.productTaskRequirements = '旧制作要求';
    const facts = rules.productPlanningFacts(parameter.metadata);
    assert.doesNotMatch(JSON.stringify(facts), /carouselCount|generationTool|taskRequirements|旧工具|旧变体工具|旧制作要求/);
    assert.equal(rules.planningFingerprint(parameter.metadata), fingerprint);
    assert.equal(facts.channelRequirements, platformRules.WILDBERRIES_RULES_TEXT);
    assert.equal(task.productPlanningRequirements(parameter.metadata).channelRules, facts.channelRequirements);
    assert.equal(task.productPlanningRequirements(parameter.metadata).production.rich.required, true);
    assert.ok(!Object.hasOwn(task.productPlanningRequirements(parameter.metadata), 'taskRequirements'));
    assert.ok(!Object.hasOwn(task.productPlanningRequirements(parameter.metadata), 'imageModel'), 'AI策划不指定生图模型');
    for (const { value } of platformRules.PRODUCT_PLATFORM_OPTIONS.filter(option => option.value !== platformRules.WILDBERRIES_PLATFORM)) {
        parameter.metadata.productPlatform = value;
        parameter.metadata.productPlatformRules = platformRules.WILDBERRIES_RULES_TEXT;
        assert.equal(rules.productPlanningFacts(parameter.metadata).channelRequirements, '', value);
        const requirements = task.productPlanningRequirements(parameter.metadata);
        assert.equal(requirements.channelRules, '', value);
        assert.equal(requirements.production, null, value);
    }
});

test('图片关键词按需进入策划，未填关键词仍可按用途标注总数或尺寸，清空不会使旧方案失效', () => {
    const loader = modules(), rules = loader.load('Excel画布/商品提示词规则.ts');
    const task = loader.load('Excel画布/商品策划任务规则.ts');
    const { parameter } = variantFixture();
    const fingerprint = rules.planningFingerprint(parameter.metadata);
    assert.equal(task.productPlanningRequirements(parameter.metadata).imageKeywordRequirement, null);
    assert.equal(task.productPlanningRequirements(parameter.metadata).production.mainAndCarousel.overlayText, 'as-needed');
    assert.match(task.productPlanningRequirements(parameter.metadata).imageTextPlanning, /不展示用户关键词不等于无字/);
    assert.match(task.productPlanningRequirements(parameter.metadata).imageTextPlanning, /已确认的总数/);
    parameter.metadata.productBrief.imageKeywords = '  Лёгкий\nУдобный  ';
    const facts = rules.productPlanningFacts(parameter.metadata), requirements = task.productPlanningRequirements(parameter.metadata);
    assert.equal(facts.brief.imageKeywords, 'Лёгкий\nУдобный');
    assert.ok(facts.variants.every(variant => variant.brief.imageKeywords === facts.brief.imageKeywords));
    assert.equal(requirements.imageKeywordRequirement.text, facts.brief.imageKeywords);
    assert.equal(requirements.production.mainAndCarousel.overlayText, 'as-needed');
    for (const platform of ['Ozon', '亚马逊', 'Takealot', '未指定']) {
        const other = task.productPlanningRequirements({ ...parameter.metadata, productPlatform: platform });
        assert.equal(other.imageKeywordRequirement.text, facts.brief.imageKeywords);
        assert.match(other.imageTextPlanning, /总数.*尺寸/);
        assert.equal(other.production, null);
    }
    parameter.metadata.productBrief.imageKeywords = ' \n ';
    assert.equal(task.productPlanningRequirements(parameter.metadata).imageKeywordRequirement, null);
    assert.deepEqual(rules.productPlanningChanges(parameter.metadata, fingerprint), []);
    assert.ok(!Object.hasOwn(rules.productPlanningFacts(parameter.metadata).brief, 'imageKeywords'));
});

test('关键词变更显示具体失效原因，原位重写后恢复，保存快照可还原原关键词', () => {
    const { loader, fixture, rules, plan, canvas } = planned();
    const status = loader.load('Excel画布/商品提示词状态.ts');
    const recovery = loader.load('Excel画布/商品提示词恢复.ts');
    const ids = fixture.nodes.map(node => node.id), connections = structuredClone(fixture.connections);
    fixture.parameter.metadata.productBrief.imageKeywords = 'Лёгкий';
    let groups = status.productPromptWarningGroups(fixture.nodes);
    assert.ok(groups[0].reasons.some(reason => /需要在图片中展现的关键词已从“未填写”改为“Лёгкий”/.test(reason)));
    apply(fixture, canvas.productPlanOps(fixture.parameter, plan, fixture.nodes, fixture.connections, rules.planningFingerprint(fixture.parameter.metadata)));
    assert.deepEqual(status.productPromptWarningGroups(fixture.nodes), []);
    assert.deepEqual(fixture.nodes.map(node => node.id), ids);
    assert.deepEqual(fixture.connections, connections);
    fixture.parameter.metadata.productBrief.imageKeywords = 'Удобный';
    groups = status.productPromptWarningGroups(fixture.nodes);
    assert.ok(groups[0].reasons.some(reason => /关键词已从“Лёгкий”改为“Удобный”/.test(reason)));
    const promptIds = fixture.nodes.filter(node => rules.promptDocument(node)).map(node => node.id);
    apply(fixture, recovery.productPromptRestoreOps(fixture.nodes, fixture.connections, promptIds));
    assert.equal(fixture.parameter.metadata.productBrief.imageKeywords, 'Лёгкий');
    assert.deepEqual(status.productPromptWarningGroups(fixture.nodes), []);
});

test('真实策划入口传入关键词；套装图不展示关键词仍保留总数标注，各图仅使用本图文字与排版', async () => {
    let incoming;
    const fixture = variantFixture();
    fixture.parameter.metadata.productBrief.imageKeywords = 'Лёгкий\nУдобный';
    fixture.nodes = [fixture.parameter]; fixture.connections = [];
    const data = planData(['red', 'blue']);
    const overlay = {
        english: ' Render the exact words "Лёгкий" and "Удобный" in bold sans-serif type, with a clear heading hierarchy, dark green lettering at the upper left, left aligned with safe margins, without covering the product.',
        chinese: ' 在左上角以粗体无衬线字体实际显示“Лёгкий”和“Удобный”，明确标题层级，深绿色文字、左对齐并保留安全边距，不遮挡商品。',
    };
    for (const pair of [data.images[0].prompt, ...Object.values(data.images[0].variants)]) {
        pair.english += ' Add a clear "2" total-pieces annotation in sans-serif type at the upper right, without keyword headings.';
        pair.chinese += ' 右上角使用无衬线字体清晰标注套装总数“2”，不添加关键词标题。';
    }
    data.images[0].copyLayout = '右上角使用无衬线字体标注真实套装总数“2”，不展示用户关键词。';
    for (const pair of [data.images[1].prompt, ...Object.values(data.images[1].variants)]) {
        pair.english += overlay.english; pair.chinese += overlay.chinese;
    }
    data.images[1].copyLayout = '左上角显示“Лёгкий”和“Удобный”，粗体无衬线、深绿色、左对齐，保留安全边距。';
    const loader = modules({
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({ config: {}, isAiConfigReady: () => true }) } },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: () => ({ model: 'vision' }), getGenerationCount: () => 1 },
        './商品策划完成通知': { notifyProductPlanning() {} },
        '../产品/产品操作': { saveProductCanvas: async () => ({ persisted: true }) },
        '../画布生成/原画布文本调用': { requestCanvasText: async options => {
            incoming = options;
            await options.recordTask({ slotId: options.scope.slotId, taskId: 'keyword-task' });
            return options.applyAndSave(JSON.stringify(data), { taskId: 'keyword-task' });
        } },
    });
    const ctx = { node: fixture.parameter, getNode: id => fixture.nodes.find(node => node.id === id),
        getNodes: () => fixture.nodes, getConnections: () => fixture.connections,
        updateMetadata: patch => { fixture.parameter.metadata = { ...fixture.parameter.metadata, ...patch }; },
        applyOps: ops => apply(fixture, ops) };
    await loader.load('Excel画布/商品策划请求.ts').planProductImages(ctx, 'product', new AbortController().signal);
    const request = JSON.parse(incoming.messages[1].content[0].text);
    assert.equal(request.requirements.imageKeywordRequirement.text, fixture.parameter.metadata.productBrief.imageKeywords);
    assert.equal(request.facts.brief.imageKeywords, request.requirements.imageKeywordRequirement.text);
    assert.match(request.requirements.imageTextPlanning, /不展示用户关键词不等于无字/);
    assert.match(incoming.messages[0].content, /不将全部关键词机械重复到每张图/);
    assert.match(incoming.messages[0].content, /数量或套装图应优先清晰展示已确认的总数/);
    const rules = loader.load('Excel画布/商品提示词规则.ts');
    const generator = loader.load('画布生成/商品提示词生成.ts');
    const configs = fixture.nodes.filter(node => node.type === 'config');
    const jobs = loader.load('画布生成/产品变体生成.ts').planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'keywords');
    assert.equal(jobs.length, 4);
    for (const job of jobs) {
        const doc = rules.promptDocument(fixture.nodes.find(node => node.id === job.source.metadata.productPromptConfigKey));
        const result = generator.buildProductGenerationContext(job.source.id, fixture.nodes, fixture.connections, '', job.placement.productVariant);
        if (doc.kind === 'rich') {
            assert.match(result.prompt, /"Лёгкий" and "Удобный"/);
            assert.match(result.prompt, /bold sans-serif[\s\S]*upper left[\s\S]*safe margins/);
            assert.match(doc.copyLayout, /左上角.*无衬线/);
        } else {
            assert.doesNotMatch(result.prompt, /Лёгкий|Удобный/);
            assert.match(result.prompt, /"2" total-pieces annotation.*upper right/);
            assert.match(doc.copyLayout, /真实套装总数“2”/);
        }
    }
    const codec = createValueCodec({ client: {} }), value = { nodes: fixture.nodes, connections: fixture.connections };
    const encoded = await codec.encode(value), restored = await codec.decode(encoded.tree);
    assert.equal(restored.nodes[0].metadata.productBrief.imageKeywords, fixture.parameter.metadata.productBrief.imageKeywords);
    assert.deepEqual(restored.nodes.map(node => rules.promptDocument(node)), fixture.nodes.map(node => rules.promptDocument(node)));
});

test('完整中英方案校验；缺少变体、中文、有效尺寸或独立英文时不落地', () => {
    const loader = modules(), rules = loader.load('Excel画布/商品提示词规则.ts');
    const original = planData(['red', 'blue']);
    assert.equal(rules.parseProductImagePlan(JSON.stringify(original), ['red', 'blue']).images.length, 2);
    for (const mutate of [
        value => delete value.images[0].variants.blue,
        value => value.images[0].prompt.chinese = 'english only',
        value => value.images[0].delivery.width = 0,
        value => value.images[0].prompt.english = 'same as before',
        value => value.images[1].key = value.images[0].key,
    ]) {
        const value = structuredClone(original); mutate(value);
        assert.throws(() => rules.parseProductImagePlan(JSON.stringify(value), ['red', 'blue']));
    }
    const questions = { ...original, images: [], pendingFacts: ['销售数量待确认'] };
    assert.equal(rules.parseProductImagePlan(JSON.stringify(questions), ['red', 'blue']).images.length, 0);
    const task = loader.load('Excel画布/商品策划任务规则.ts');
    const wrong = rules.parseProductImagePlan(JSON.stringify(original), ['red', 'blue']);
    wrong.images[0].delivery.width = 1024;
    assert.throws(() => task.validateProductPlanRequirements(wrong, { productPlatform: 'Wildberries' }), /交付要求/);
    assert.doesNotThrow(() => task.validateProductPlanRequirements(wrong, { productPlatform: '亚马逊' }));
});

test('新策划分段双语与旧全文都兼容，引用和精确尺寸逐字保留', () => {
    const rules = modules().load('Excel画布/商品提示词规则.ts'), data = planData([]);
    const segments = [
        { chinese: '仅编辑数字0原图，', english: 'Edit the digit 0 original photo only, ' },
        { chinese: '保留3.2cm/1.3in和6cm/2.4in，不改变商品。', english: 'keep 3.2cm/1.3in and 6cm/2.4in, and preserve the actual product.' },
    ];
    data.images[0].prompt = { segments };
    const plan = rules.parseProductImagePlan(JSON.stringify(data), []);
    assert.equal(plan.images[0].prompt.chinese, segments.map(segment => segment.chinese).join(''));
    assert.equal(plan.images[0].prompt.english, segments.map(segment => segment.english).join(''));
    assert.equal(plan.images[0].prompt.alignment.length, 2);
    assert.equal(rules.isPromptReady(plan.images[0].prompt), true);
    assert.equal(plan.images[1].prompt.alignment, undefined);
});

test('未指定平台保留尺寸补充，不带入旧平台规则或强制主图与富内容', () => {
    const loader = modules(), rules = loader.load('Excel画布/商品提示词规则.ts');
    const task = loader.load('Excel画布/商品策划任务规则.ts');
    const { parameter } = variantFixture();
    parameter.metadata.productPlatform = '未指定';
    parameter.metadata.productBrief.dimensions = '所有数字共用：宽3.2 cm，高6 cm';
    parameter.metadata.promptVariableSupplement = '只给每个变体的原图添加尺寸标注';
    const facts = rules.productPlanningFacts(parameter.metadata);
    assert.equal(facts.platform, '未指定');
    assert.equal(facts.channelRequirements, '');
    assert.match(facts.brief.dimensions, /宽3.2 cm，高6 cm/);
    assert.match(facts.supplement, /只给每个变体/);
    assert.equal(task.productPlanningRequirements(parameter.metadata).production, null);
    const plan = planData(['red', 'blue']);
    plan.images = [{ ...plan.images[0], kind: 'carousel',
        delivery: { width: 800, height: 800, format: 'png', maxMB: null } }];
    assert.doesNotThrow(() => task.validateProductPlanRequirements(
        rules.parseProductImagePlan(JSON.stringify(plan), ['red', 'blue']), parameter.metadata));
});

test('重新策划原位更新手改提示词，保留原卡ID、位置、尺寸、连线和用户的模型设置', () => {
    const { fixture, rules, plan, canvas, fingerprint } = planned();
    const prompts = fixture.nodes.filter(node => rules.promptDocument(node));
    rules.promptDocument(prompts[0]).variants.red.chinese += '手动修改';
    const config = fixture.nodes.find(node => node.metadata.productPromptConfigKey === prompts[0].id);
    config.metadata.model = 'user-chosen-model'; config.metadata.count = 3; config.metadata.quality = 'high';
    prompts[0].position = { x: 1234, y: 2345 }; prompts[0].width = 500; prompts[0].height = 620;
    config.position = { x: 1900, y: 2500 };
    const original = structuredClone({ nodes: fixture.nodes, connections: fixture.connections });
    plan.images[0].variants.red.chinese = '重新策划后的中文';
    apply(fixture, canvas.productPlanOps(fixture.parameter, plan, fixture.nodes, fixture.connections, fingerprint));
    assert.equal(fixture.nodes.length, original.nodes.length);
    assert.deepEqual(fixture.nodes.map(node => node.id), original.nodes.map(node => node.id));
    assert.deepEqual(fixture.nodes.map(node => [node.position, node.width, node.height]), original.nodes.map(node => [node.position, node.width, node.height]));
    assert.deepEqual(fixture.connections, original.connections);
    assert.equal(rules.promptDocument(prompts[0]).variants.red.chinese, '重新策划后的中文');
    assert.equal(config.metadata.model, 'user-chosen-model'); assert.equal(config.metadata.count, 3); assert.equal(config.metadata.quality, 'high');
    assert.equal(fixture.nodes.filter(node => rules.promptDocument(node) && !node.metadata.productPromptRetired).length, 4);
    assert.equal(fixture.nodes.filter(node => node.type === 'config' && !node.metadata.productPromptRetired).length, 4);
});

test('平台改变后的新用途名称和key优先复用同变体原卡，不占用后续精确匹配的卡片', () => {
    const { fixture, rules, plan, canvas } = planned();
    const before = structuredClone(fixture.nodes);
    const originalIds = new Map(fixture.nodes.filter(node => rules.promptDocument(node))
        .map(node => [`${rules.promptDocument(node).key}:${rules.promptDocument(node).variantId}`, node.id]));
    fixture.parameter.metadata.productPlatform = '亚马逊';
    plan.images = [{ ...plan.images[1], key: 'new-instructions', name: '新使用说明' }, plan.images[0]];
    const operations = canvas.productPlanOps(fixture.parameter, plan, fixture.nodes, fixture.connections, rules.planningFingerprint(fixture.parameter.metadata));
    assert.equal(operations.filter(op => op.type === 'add_node').length, 0);
    apply(fixture, operations);
    for (const node of fixture.nodes.filter(node => rules.promptDocument(node))) {
        const doc = rules.promptDocument(node);
        assert.equal(node.id, originalIds.get(`${doc.key === 'main' ? 'main' : 'rich'}:${doc.variantId}`));
        assert.equal(rules.productPlanningChanges(fixture.parameter.metadata, node.metadata.productPromptSourceFingerprint, { ignoreLanguage: true }).length, 0);
    }
    assert.deepEqual(fixture.nodes.map(node => [node.id, node.position]), before.map(node => [node.id, node.position]));
});

test('变更后立即可推导失效状态和常驻原因，写清原平台、当前平台及恢复方式；恢复后自动清除', () => {
    const { loader, fixture } = planned();
    const status = loader.load('Excel画布/商品提示词状态.ts');
    assert.deepEqual(status.productPromptWarningGroups(fixture.nodes), []);
    fixture.parameter.metadata.productPlatform = '亚马逊';
    const groups = status.productPromptWarningGroups(fixture.nodes);
    assert.equal(groups.length, 1); assert.equal(groups[0].nodeIds.length, 4);
    assert.match(groups[0].reasons[0], /上架平台已从“Wildberries”改为“亚马逊”/);
    assert.match(groups[0].reasons[0], /上架平台恢复为“Wildberries”/);
    assert.match(groups[0].reasons[0], /更新原卡片/);
    fixture.parameter.metadata.productPlatform = 'Wildberries';
    assert.deepEqual(status.productPromptWarningGroups(fixture.nodes), []);
    fixture.parameter.metadata.productLanguage = '中文';
    assert.deepEqual(status.productPromptWarningGroups(fixture.nodes), []);
    fixture.parameter.metadata.productBrief.dimensions = '新尺寸';
    const dimensions = status.productPromptWarningGroups(fixture.nodes)[0].reasons;
    assert.ok(dimensions.some(reason => /真实尺寸与参数已从“共用尺寸”改为“新尺寸”/.test(reason)));
});

test('一键恢复原参数并清除失效，保留语言、变体勾选、卡片和连线；旧方案也支持恢复', () => {
    const { loader, fixture, rules } = planned();
    const recovery = loader.load('Excel画布/商品提示词恢复.ts'), status = loader.load('Excel画布/商品提示词状态.ts');
    const original = structuredClone(fixture.parameter.metadata);
    const promptIds = fixture.nodes.filter(node => rules.promptDocument(node)).map(node => node.id);
    for (const legacy of [false, true]) {
        fixture.parameter.metadata = structuredClone(original);
        if (legacy) delete fixture.parameter.metadata.productImagePlan.source;
        fixture.parameter.metadata.productPlatform = '亚马逊'; fixture.parameter.metadata.productPlatformRules = '';
        fixture.parameter.metadata.productLanguage = '中文'; fixture.parameter.metadata.productVariants[0].enabled = false;
        fixture.parameter.metadata.productBrief.dimensions = '新的错误尺寸';
        const before = structuredClone({ nodes: fixture.nodes, connections: fixture.connections });
        const operations = recovery.productPromptRestoreOps(fixture.nodes, fixture.connections, promptIds);
        apply(fixture, operations);
        assert.equal(fixture.parameter.metadata.productPlatform, 'Wildberries');
        assert.equal(fixture.parameter.metadata.productBrief.dimensions, original.productBrief.dimensions);
        assert.equal(fixture.parameter.metadata.productLanguage, '中文');
        assert.equal(fixture.parameter.metadata.productVariants[0].enabled, false);
        assert.deepEqual(status.productPromptWarningGroups(fixture.nodes), []);
        assert.deepEqual(fixture.connections, before.connections);
        assert.deepEqual(fixture.nodes.filter(node => node.id !== fixture.parameter.id), before.nodes.filter(node => node.id !== fixture.parameter.id));
    }
});

test('一键恢复图片与变体使用策划原文件，不能把新文件伪装成旧参考图', () => {
    const { loader, fixture, rules } = planned();
    const recovery = loader.load('Excel画布/商品提示词恢复.ts'), status = loader.load('Excel画布/商品提示词状态.ts');
    const ids = fixture.nodes.filter(node => rules.promptDocument(node)).map(node => node.id);
    fixture.parameter.metadata.productMainImages[0].storageKey = 'different-file';
    fixture.parameter.metadata.productVariants[0].name = '用户改名';
    fixture.parameter.metadata.productSharedImageIds = [];
    const operations = recovery.productPromptRestoreOps(fixture.nodes, fixture.connections, ids);
    assert.deepEqual(recovery.restoredProductImages(fixture.nodes, operations).map(image => image.storageKey), ['stored-red']);
    apply(fixture, operations);
    assert.equal(fixture.parameter.metadata.productVariants[0].name, '红色');
    assert.deepEqual(status.productPromptWarningGroups(fixture.nodes), []);
});

test('策划原参数快照通过真实应用编码与SQLite文档校验，不保存临时网址或增加嵌套深度', async () => {
    const { fixture, rules } = planned();
    fixture.parameter.metadata.productMainImages[0].url = 'blob:http://localhost:3000/transient';
    const snapshot = rules.productPlanningParameters(fixture.parameter.metadata);
    assert.equal(typeof snapshot, 'string');
    assert.doesNotMatch(snapshot, /blob:http/);
    delete fixture.parameter.metadata.productMainImages[0].url;
    fixture.parameter.metadata.productImagePlan.source.parameters = snapshot;
    const value = { state: { projects: [{ id: 'product', nodes: fixture.nodes, connections: fixture.connections }] }, version: 1 };
    const encoded = await createValueCodec({ client: {} }).encode(value);
    assert.doesNotThrow(() => serializeDocument('extension', 'test-app-state', { format: 'guan-app-storage.v1', namespace: 'app_state',
        entries: [['infinite-canvas:canvas_store', encoded]] }, encoded.mediaIds));
});

test('普通提示随常驻框高度下移，旧提示退出不能清掉新框占位，退出完成后恢复顶部', () => {
    const layout = modules().load('存储界面/消息浮层布局.ts');
    const first = layout.reservePersistentMessage('same-key');
    const next = layout.reservePersistentMessage('same-key');
    try {
        assert.equal(layout.transientMessageTop(), 92);
        first.resize(48);
        assert.equal(layout.transientMessageTop(), 148);
        next.resize(100);
        assert.equal(layout.transientMessageTop(), 200);
        first.release();
        assert.equal(layout.transientMessageTop(), 200);
        next.resize(60);
        assert.equal(layout.transientMessageTop(), 160);
    } finally { first.release(); next.release(); }
    assert.equal(layout.transientMessageTop(), 92);
});

test('批量变体使用各自英文与图片；任一翻译过期、资料更改或旧卡片均在提交前拒绝', () => {
    const { loader, fixture, rules } = planned();
    const generator = loader.load('画布生成/商品提示词生成.ts');
    const batch = loader.load('画布生成/产品变体生成.ts');
    const configs = fixture.nodes.filter(node => node.type === 'config');
    const jobs = batch.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'batch');
    assert.equal(jobs.length, 4);
    for (const job of jobs) {
        const variant = job.placement.productVariant;
        const context = generator.buildProductGenerationContext(job.source.id, fixture.nodes, fixture.connections, '', variant);
        assert.match(context.prompt, new RegExp(`actual ${variant.snapshot.id} travel bag`));
        assert.doesNotMatch(context.prompt, /当前销售变体|变量与画面约束/);
        assert.deepEqual(context.referenceImages.map(image => image.id), [variant.snapshot.id, 'shared']);
    }
    const prompt = fixture.nodes.find(node => rules.promptDocument(node)?.variantId === 'blue');
    const pair = rules.promptDocument(prompt).variants.blue;
    pair.chinese += '新的修改';
    assert.throws(() => batch.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'batch'), /尚未同步/);
    pair.translatedChinese = pair.chinese;
    fixture.parameter.metadata.productBrief.material = '新材质';
    assert.throws(() => batch.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'batch'), /材质／成分已从“棉”改为“新材质”/);
});

test('刷新后的临时图片地址不使旧策划过期；文件、配图或资料变化仍阻止提交', () => {
    const { loader, fixture, rules } = planned();
    const batch = loader.load('画布生成/产品变体生成.ts');
    const configs = fixture.nodes.filter(node => node.type === 'config');
    for (const node of fixture.nodes.filter(node => rules.promptDocument(node))) {
        const old = JSON.parse(node.metadata.productPromptSourceFingerprint);
        for (const image of old[1]) image[2] = `blob:http://localhost:3000/old-${image[0]}`;
        node.metadata.productPromptSourceFingerprint = JSON.stringify(old);
    }
    for (const image of fixture.parameter.metadata.productMainImages) image.url = `blob:http://localhost:3000/new-${image.id}`;
    const baseline = structuredClone(fixture.parameter.metadata);
    assert.equal(batch.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'batch').length, 4);
    for (const [change, expected] of [
        [value => value.productBrief.dimensions = '改为新尺寸', /真实尺寸与参数/],
        [value => value.productSharedImageIds = [], /资料或配图/],
        [value => value.productMainImages[0].storageKey = 'replaced-image', /参考图/],
    ]) {
        fixture.parameter.metadata = structuredClone(baseline); change(fixture.parameter.metadata);
        assert.throws(() => batch.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'batch'), expected);
    }
    fixture.parameter.metadata = structuredClone(baseline);
    delete fixture.parameter.metadata.productMainImages[0].storageKey;
    fixture.parameter.metadata.productMainImages[0].url = 'https://example.test/original.png';
    const urlBased = rules.planningFingerprint(fixture.parameter.metadata);
    fixture.parameter.metadata.productMainImages[0].url = 'https://example.test/replaced.png';
    assert.ok(rules.productPlanningChanges(fixture.parameter.metadata, urlBased).includes('参考图'));
    assert.deepEqual(rules.productPlanningChanges(fixture.parameter.metadata, 'invalid'), ['策划来源记录缺失']);
});

test('只改图片文字语言保留AI提示词，实际生图请求使用当前语言，不重做策划或改动尺寸标注', () => {
    const { loader, fixture, rules } = planned();
    const batch = loader.load('画布生成/产品变体生成.ts');
    const generator = loader.load('画布生成/商品提示词生成.ts');
    const task = loader.load('Excel画布/商品策划任务规则.ts');
    const configs = fixture.nodes.filter(node => node.type === 'config');
    const prompts = fixture.nodes.filter(node => rules.promptDocument(node));
    const original = structuredClone(prompts);
    for (const [language, target] of [['俄文', 'Russian'], ['英文', 'English'], ['中文', 'Chinese'], ['', 'unspecified']]) {
        fixture.parameter.metadata.productLanguage = language;
        const jobs = batch.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'language');
        assert.equal(jobs.length, 4);
        for (const job of jobs) {
            const context = generator.buildProductGenerationContext(job.source.id, fixture.nodes, fixture.connections, '', job.placement.productVariant);
            assert.ok(context.prompt.includes(`Image text language: ${target}.`));
            assert.match(context.prompt, /numbers, measurement units and exact dimension strings unchanged/);
            assert.match(context.prompt, /Do not add words to a text-free image/);
            assert.ok(context.prompt.includes(rules.readProductPrompt(prompts.find(node => node.id === job.source.metadata.productPromptConfigKey))));
            assert.deepEqual(context.referenceImages.map(image => image.id), [job.placement.productVariant.snapshot.id, 'shared']);
        }
        assert.ok(task.productPlanningRequirements(fixture.parameter.metadata).imageTextLanguageRequirement.includes(`Image text language: ${target}.`));
    }
    assert.deepEqual(prompts, original, '语言设置不能改写、作废或重新翻译既有提示词');
    fixture.parameter.metadata.productLanguage = '俄文';
    const job = batch.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'snapshot')[0];
    fixture.parameter.metadata.productLanguage = '中文';
    const snapshot = generator.buildProductGenerationContext(job.source.id, fixture.nodes, fixture.connections, '', job.placement.productVariant);
    assert.match(snapshot.prompt, /Image text language: Russian/);
    assert.doesNotMatch(snapshot.prompt, /Image text language: Chinese/);
});

test('尺寸标注提示词的数字单位原文保留；旧俄文要求由本次中文设置覆盖且不更改商品与画面', () => {
    const { loader, fixture, rules } = planned();
    const config = fixture.nodes.find(node => node.type === 'config');
    const prompt = fixture.nodes.find(node => node.id === config.metadata.productPromptConfigKey);
    const pair = rules.promptPair(rules.promptDocument(prompt));
    pair.english += ' Add only "3.2cm/1.3in" and "6cm/2.4in". Render ordinary captions in Russian.';
    fixture.parameter.metadata.productLanguage = '中文';
    const job = loader.load('画布生成/产品变体生成.ts').planProductGenerationJobs([config], fixture.nodes, fixture.connections, 'dimension')[0];
    const context = loader.load('画布生成/商品提示词生成.ts').buildProductGenerationContext(config.id, fixture.nodes, fixture.connections, '', job.placement.productVariant);
    assert.match(context.prompt, /"3\.2cm\/1\.3in" and "6cm\/2\.4in"/);
    assert.ok(context.prompt.lastIndexOf('Image text language: Chinese') > context.prompt.indexOf('Render ordinary captions in Russian'));
    assert.match(context.prompt, /replaces earlier language directions for ordinary on-image copy only/);
    assert.match(context.prompt, /introduce captions when only dimension annotations are requested/);
    assert.match(context.prompt, /Preserve all product, composition and editing constraints/);
});

test('短名称突出变体和用途，旧卡片只改自动名称，保留手改名称、提示词、配置、ID及连线', () => {
    const { fixture, rules, canvas } = planned();
    const prompts = fixture.nodes.filter(node => rules.promptDocument(node));
    for (const node of prompts) {
        const doc = rules.promptDocument(node);
        doc.planName = '数字0–9原图尺寸标注：每个变体一张';
        doc.name = `${doc.variantName} · ${doc.planName}`;
        node.title = doc.name;
        const config = fixture.nodes.find(item => item.metadata.productPromptConfigKey === node.id);
        config.title = `${doc.name} · 生成`;
    }
    const custom = prompts[0], config = fixture.nodes.find(item => item.metadata.productPromptConfigKey === custom.id);
    custom.title = '用户手动名称'; config.title = '用户指定配置';
    const before = structuredClone({ nodes: fixture.nodes, connections: fixture.connections });
    const operations = canvas.compactProductPromptTitles(fixture.parameter, fixture.nodes);
    apply(fixture, operations);
    assert.equal(custom.title, '用户手动名称'); assert.equal(config.title, '用户指定配置');
    for (const prompt of prompts.slice(1)) {
        const doc = rules.promptDocument(prompt);
        const expected = `${doc.variantName} · 尺寸标注 ${doc.key === 'main' ? 1 : 2}`;
        assert.equal(prompt.title, expected);
        assert.equal(fixture.nodes.find(item => item.metadata.productPromptConfigKey === prompt.id).title, `${expected} · 生图`);
        assert.equal(rules.productPromptTitle(doc), `${doc.variantName} · 尺寸标注`, '单一方案不添加多余编号');
    }
    assert.deepEqual(fixture.nodes.map(node => node.id), before.nodes.map(node => node.id));
    assert.deepEqual(fixture.nodes.map(node => node.metadata), before.nodes.map(node => node.metadata));
    assert.deepEqual(fixture.connections, before.connections);
    assert.deepEqual(canvas.compactProductPromptTitles(fixture.parameter, fixture.nodes), []);
    const brief = { ...rules.promptDocument(prompts[1]), key: 'dimensions-front' };
    const other = { ...brief, key: 'dimensions-side' };
    assert.notEqual(rules.productPromptTitle(brief, [brief, other]), rules.productPromptTitle(other, [brief, other]), '缩短后同名的不同方案需保留可见编号');
});

test('十个变体拆成十对纵向卡片，单卡只执行一个变体，批量不平方展开', () => {
    const loader = modules(), fixture = variantFixture();
    const ids = Array.from({ length: 10 }, (_, i) => String(i));
    fixture.parameter.metadata.productPlatform = '未指定';
    fixture.parameter.metadata.productVariants = ids.map(id => ({ ...fixture.variant(id, id), name: `数字${id}`, attributes: {} }));
    fixture.parameter.metadata.productMainImages = [...ids.map(id => fixture.image(id)), fixture.image('shared')];
    fixture.nodes = [fixture.parameter]; fixture.connections = [];
    const rules = loader.load('Excel画布/商品提示词规则.ts'), canvas = loader.load('Excel画布/商品提示词画布.ts');
    const plan = planData(ids); plan.images = [plan.images[0]];
    apply(fixture, canvas.productPlanOps(fixture.parameter, rules.parseProductImagePlan(JSON.stringify(plan), ids),
        fixture.nodes, fixture.connections, rules.planningFingerprint(fixture.parameter.metadata)));
    const prompts = fixture.nodes.filter(node => rules.promptDocument(node)), configs = fixture.nodes.filter(node => node.type === 'config');
    assert.equal(prompts.length, 10); assert.equal(configs.length, 10); assert.equal(fixture.connections.length, 20);
    assert.deepEqual(prompts.map(node => rules.promptDocument(node).variantId), ids);
    assert.equal(new Set(prompts.map(node => node.position.x)).size, 1);
    assert.equal(new Set(configs.map(node => node.position.x)).size, 1);
    for (let i = 0; i < prompts.length; i++) {
        assert.equal(prompts[i].position.y + prompts[i].height / 2, configs[i].position.y + configs[i].height / 2);
        if (i) assert.ok(prompts[i].position.y >= prompts[i - 1].position.y + prompts[i - 1].height + 48);
    }
    const batch = loader.load('画布生成/产品变体生成.ts');
    const jobs = batch.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'batch');
    assert.equal(jobs.length, 10);
    const generator = loader.load('画布生成/商品提示词生成.ts');
    assert.equal(generator.productPromptInputSummary(configs[0].id, fixture.nodes, fixture.connections,
        { textCount: 1, imageCount: 0, videoCount: 0, audioCount: 0 }).imageCount, 2);
    assert.deepEqual(jobs.map(job => job.placement.productVariant.snapshot.id).sort(), ids);
    assert.equal(batch.planProductGenerationJobs([configs[0]], fixture.nodes, fixture.connections, 'single').length, 1);
    fixture.parameter.metadata.productVariants[0].enabled = false;
    assert.equal(batch.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'partial').length, 9);
});

test('已有合并卡无须重调AI即可展开，保留各变体手改内容、原ID和配置，重复执行无变化', () => {
    const loader = modules(), fixture = variantFixture();
    const rules = loader.load('Excel画布/商品提示词规则.ts'), canvas = loader.load('Excel画布/商品提示词画布.ts');
    const plan = rules.parseProductImagePlan(JSON.stringify(planData(['red', 'blue'])), ['red', 'blue']);
    const brief = plan.images[0];
    brief.variants.blue.chinese += '用户手改内容';
    const source = { id: 'legacy', type: 'guan:product-prompt', title: brief.name, position: { x: 500, y: 0 }, width: 440, height: 540,
        metadata: { productImagePrompt: { ...brief, parameterId: fixture.parameter.id, generatedSignature: 'old' },
            productPromptSourceFingerprint: rules.planningFingerprint(fixture.parameter.metadata) } };
    const config = { ...fixture.config, metadata: { ...fixture.config.metadata, productPromptConfigKey: source.id } };
    fixture.nodes = [fixture.parameter, source, config]; fixture.connections = [
        { id: 'p', fromNodeId: fixture.parameter.id, toNodeId: source.id }, { id: 'c', fromNodeId: source.id, toNodeId: config.id }];
    apply(fixture, canvas.expandLegacyProductPrompts(fixture.parameter, fixture.nodes, fixture.connections));
    assert.equal(fixture.nodes.filter(node => rules.promptDocument(node)).length, 2);
    assert.equal(fixture.nodes.filter(node => node.type === 'config').length, 2);
    assert.equal(rules.promptDocument(fixture.nodes.find(node => node.id === 'legacy')).variantId, 'red');
    assert.match(rules.promptDocument(fixture.nodes.find(node => rules.promptDocument(node)?.variantId === 'blue')).variants.blue.chinese, /用户手改内容/);
    assert.equal(fixture.nodes.find(node => node.id === config.id).metadata.count, 2);
    assert.deepEqual(canvas.expandLegacyProductPrompts(fixture.parameter, fixture.nodes, fixture.connections), []);
});

test('整理卡片后AI提示词及配置仍在对应两列且每行居中对齐', () => {
    const { loader, fixture, rules } = planned();
    const layout = loader.load('画布布局/画布整体排布.ts');
    const next = layout.layoutCanvas(fixture.nodes, fixture.connections);
    const prompts = next.filter(node => rules.promptDocument(node));
    const configs = next.filter(node => node.type === 'config');
    assert.equal(new Set(prompts.map(node => node.position.x)).size, 1);
    assert.equal(new Set(configs.map(node => node.position.x)).size, 1);
    for (const prompt of prompts) {
        const config = configs.find(node => node.metadata.productPromptConfigKey === prompt.id);
        assert.equal(prompt.position.y + prompt.height / 2, config.position.y + config.height / 2);
    }
});

test('策划服务记录并保存任务后落地，非法结果、旧资料与取消不会创建卡片；系统角色无平台污染', async () => {
    let incoming, failSave = false, failFinalSave = false, cancelled = false, mutateSource = false, noImages = false;
    const fixture = variantFixture(); fixture.nodes = [fixture.parameter]; fixture.connections = [];
    let ops = 0, saves = 0;
    const notifications = [];
    const loader = modules({
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({ config: { channels: [], imageModel: 'user-selected-image' }, isAiConfigReady: () => true }) } },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: () => ({ model: 'vision' }) },
        './商品策划完成通知': { notifyProductPlanning: (productId, parameterId, completed) => notifications.push({ productId, parameterId, completed, saves }) },
        '../产品/产品操作': { saveProductCanvas: async () => { saves++; return { persisted: !failSave && !(failFinalSave && saves % 2 === 0) }; } },
        '../画布生成/原画布文本调用': { requestCanvasText: async options => {
            incoming = options;
            await options.recordTask({ slotId: options.scope.slotId, taskId: 'mock-task' });
            if (cancelled) controller.abort();
            if (mutateSource) fixture.parameter.metadata.productBrief.nameCategory += '变更';
            const plan = planData(['red', 'blue']);
            if (noImages) { plan.images = []; plan.pendingFacts = ['销售数量待确认']; }
            return options.applyAndSave(JSON.stringify(plan), { taskId: 'mock-task' });
        } },
    });
    const ctx = { node: fixture.parameter, getNode: id => fixture.nodes.find(node => node.id === id),
        getNodes: () => fixture.nodes, getConnections: () => fixture.connections,
        updateMetadata: patch => { fixture.parameter.metadata = { ...fixture.parameter.metadata, ...patch }; },
        applyOps: value => { ops++; apply(fixture, value); } };
    let controller = new AbortController();
    const service = loader.load('Excel画布/商品策划请求.ts');
    const phases = [];
    await service.planProductImages(ctx, 'product', controller.signal, phase => phases.push({ phase, saves }));
    assert.equal(ops, 1); assert.equal(saves, 2);
    assert.deepEqual(phases.map(item => item.phase), ['preparing', 'requesting', 'saving-task', 'requesting', 'validating', 'saving-result', 'ready']);
    assert.equal(phases.at(-1).saves, 2, '阶段成功也必须等最终保存ACK');
    assert.deepEqual(notifications, [
        { productId: 'product', parameterId: fixture.parameter.id, completed: false, saves: 0 },
        { productId: 'product', parameterId: fixture.parameter.id, completed: true, saves: 2 },
    ], '只有策划卡片和回执保存确认后才提示一键生图');
    assert.ok(fixture.nodes.filter(node => node.type === 'config').every(node => node.metadata.model === 'user-selected-image'));
    assert.doesNotMatch(incoming.messages[0].content, /Wildberries|1800|2400/);
    assert.match(incoming.messages[1].content[0].text, /Wildberries/);
    failSave = true;
    await assert.rejects(service.planProductImages(ctx, 'product', controller.signal), /保存尚未确认/);
    assert.equal(ops, 1); failSave = false; mutateSource = true;
    await assert.rejects(service.planProductImages(ctx, 'product', controller.signal), /资料或参考图已更改/);
    assert.equal(ops, 1); mutateSource = false; cancelled = true; controller = new AbortController();
    await assert.rejects(service.planProductImages(ctx, 'product', controller.signal), error => error.name === 'AbortError');
    assert.equal(ops, 1);
    assert.equal(notifications.filter(item => item.completed).length, 1);
    cancelled = false; controller = new AbortController(); failFinalSave = true; saves = 0;
    await assert.rejects(service.planProductImages(ctx, 'product', controller.signal), /保存尚未确认/);
    assert.equal(notifications.filter(item => item.completed).length, 1, '最后保存失败也不能提示成功');
    failFinalSave = false; noImages = true;
    const pendingPhases = [];
    await service.planProductImages(ctx, 'product', controller.signal, phase => pendingPhases.push(phase));
    assert.equal(notifications.filter(item => item.completed).length, 1, '只有待确认问题时不能提供一键生图');
    assert.equal(pendingPhases.at(-1), 'needs-input', '仅待补资料不能停留在保存中的旋转状态');
});

test('中文翻译不会覆盖迟到的新编辑；翻译回执落盘后才确认同步', async () => {
    const { fixture, rules } = planned();
    const node = fixture.nodes.find(node => rules.promptDocument(node));
    let request, saves = 0;
    const loader = modules({
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({ config: {}, isAiConfigReady: () => true }) } },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: () => ({ model: 'text' }) },
        '../产品/产品操作': { saveProductCanvas: async () => { saves++; return { persisted: true }; } },
        '../画布生成/原画布文本调用': { requestCanvasText: async options => {
            await options.recordTask({ slotId: options.scope.slotId, taskId: 'translate' }); request = options;
        } },
    });
    const ctx = { node, getNode: () => node, updateMetadata: value => { node.metadata = { ...node.metadata, ...value }; } };
    const service = loader.load('Excel画布/商品策划请求.ts'), signal = new AbortController().signal;
    rules.promptDocument(node).variants.red.chinese = '用户第一版中文';
    await service.translateProductPrompt(ctx, 'product', 'red', signal);
    rules.promptDocument(node).variants.red.chinese = '用户第二版中文';
    await assert.rejects(request.applyAndSave(pair('red').english, { taskId: 'translate' }), /旧翻译已丢弃/);
    await service.translateProductPrompt(ctx, 'product', 'red', signal);
    await request.applyAndSave(pair('red').english, { taskId: 'translate' });
    assert.equal(rules.isPromptReady(rules.promptDocument(node).variants.red), true);
    assert.equal(rules.promptDocument(node).variants.red.translatedChinese, '用户第二版中文');
    assert.equal(saves, 3);
});

test('同步翻译分段协议保留原中文及对应偏移，中文被模型改写时不覆盖译文', async () => {
    const { fixture, rules } = planned();
    const node = fixture.nodes.find(node => rules.promptDocument(node));
    const chinese = '仅编辑数字0原图；保留3.2cm和6cm。';
    const segments = [
        { chinese: '仅编辑数字0原图；', english: 'Edit the digit 0 original photo only; ' },
        { chinese: '保留3.2cm和6cm。', english: 'preserve the width 3.2cm and height 6cm.' },
    ];
    rules.promptDocument(node).variants.red.chinese = chinese;
    let response = { segments };
    const loader = modules({
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({ config: {}, isAiConfigReady: () => true }) } },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: () => ({ model: 'text' }) },
        '../产品/产品操作': { saveProductCanvas: async () => ({ persisted: true }) },
        '../画布生成/原画布文本调用': { requestCanvasText: async options => {
            await options.recordTask({ slotId: options.scope.slotId, taskId: 'translate-segments' });
            return options.applyAndSave(JSON.stringify(response), { taskId: 'translate-segments' });
        } },
    });
    const ctx = { node, getNode: () => node, updateMetadata: patch => { node.metadata = { ...node.metadata, ...patch }; } };
    const service = loader.load('Excel画布/商品策划请求.ts'), signal = new AbortController().signal;
    await service.translateProductPrompt(ctx, 'product', 'red', signal);
    const pair = rules.promptDocument(node).variants.red;
    assert.equal(pair.chinese, chinese); assert.equal(pair.translatedChinese, chinese);
    assert.equal(pair.english, segments.map(segment => segment.english).join(''));
    assert.deepEqual(pair.alignment[0], [0, segments[0].chinese.length, 0, segments[0].english.length]);
    const before = structuredClone(pair);
    response = { segments: [{ chinese: '模型修改了原中文', english: segments.map(segment => segment.english).join('') }] };
    await assert.rejects(service.translateProductPrompt(ctx, 'product', 'red', signal), /原文不一致/);
    assert.deepEqual(rules.promptDocument(node).variants.red, before);
    const value = { state: { projects: [{ id: 'product', nodes: fixture.nodes, connections: fixture.connections }] }, version: 1 };
    const codec = createValueCodec({ client: {} }), encoded = await codec.encode(value);
    assert.doesNotThrow(() => serializeDocument('extension', 'test-app-state', { format: 'guan-app-storage.v1', namespace: 'app_state',
        entries: [['infinite-canvas:canvas_store', encoded]] }, encoded.mediaIds));
    const restored = await codec.decode(encoded.tree);
    assert.deepEqual(restored.state.projects[0].nodes.find(item => item.id === node.id).metadata.productImagePrompt.variants.red.alignment, pair.alignment);
});

test('翻译错误保留可操作说明，旧资源地址、长响应和HTML不直接展示', () => {
    const { productPromptTranslationError } = modules().load('Excel画布/商品提示词规则.ts');
    const resourceError = 'Failed to fetch dynamically imported module: http://localhost:3000/assets/' + '%E5%95%86'.repeat(80) + '.js';
    assert.equal(productPromptTranslationError(new Error(resourceError)), '翻译功能暂不可用，请刷新页面后重试。');
    assert.equal(productPromptTranslationError(resourceError), '翻译功能暂不可用，请刷新页面后重试。');
    assert.equal(productPromptTranslationError(new TypeError('Failed to fetch')), '网络连接失败，请稍后重试。');
    for (const error of [undefined, '<html>server error</html>', 'x'.repeat(1000), '错误 http://localhost:3000/private'])
        assert.equal(productPromptTranslationError(error), '英文同步失败，请重试。');
    const actionable = '画布保存尚未确认，请稍后重试保存。';
    assert.equal(productPromptTranslationError(new Error(actionable)), actionable);
});

test('旧翻译错误可重试，失败仅更新错误说明，保留中英文、卡片尺寸与位置', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { fixture, rules } = planned();
    const node = fixture.nodes.find(node => rules.promptDocument(node));
    const original = structuredClone(node);
    const originalPair = rules.promptDocument(node).variants.red;
    originalPair.chinese += '手动修改';
    const chinese = originalPair.chinese, english = originalPair.english;
    const resourceError = 'Failed to fetch dynamically imported module: http://localhost:3000/assets/' + '%E5%95%86'.repeat(80) + '.js';
    originalPair.translationError = resourceError;
    const effects = [];
    let calls = 0;
    const loader = modules({
        react: { useEffect: callback => effects.push(callback), useRef: value => ({ current: value }), useState: value => [value, () => {}] },
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
        'lucide-react': { Languages: 'Languages', RotateCcw: 'RotateCcw' },
        './Excel画布上下文': { useExcelProductId: () => 'product' },
        './商品策划请求': { translateProductPrompt: async () => { calls++; throw new Error(resourceError); } },
        '../提示词/双语联动文本框': { useBilingualPromptSync: () => ({}), BilingualPromptField: 'textarea' },
    });
    const ctx = { node, theme: { node: {} }, getNode: id => fixture.nodes.find(item => item.id === id),
        updateMetadata: patch => { node.metadata = { ...node.metadata, ...patch }; } };
    const component = loader.load('Excel画布/商品提示词卡片.tsx');
    const elements = tree => {
        const result = [];
        const visit = element => {
            if (!element || typeof element !== 'object') return;
            result.push(element);
            for (const child of [element.props?.children].flat(Infinity)) visit(child);
        };
        visit(tree); return result;
    };
    const tree = component.ProductPromptContent({ ctx });
    effects.shift()();
    assert.ok(elements(tree).some(element => element.props.role === 'alert' && element.props.children === '提示词已失效'));
    const alert = elements(tree).find(element => element.type === 'span' && element.props.role === 'alert');
    assert.equal(alert.props.children, '翻译功能暂不可用，请刷新页面后重试。');
    const retry = elements(tree).find(element => element.props['aria-label'] === '重试翻译');
    retry.props.onClick();
    assert.equal(rules.promptDocument(node).variants.red.translationError, undefined);
    component.ProductPromptContent({ ctx });
    const cleanup = effects.shift()();
    t.mock.timers.tick(650);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(rules.promptDocument(node).variants.red.translationError, alert.props.children);
    assert.equal(rules.promptDocument(node).variants.red.chinese, chinese);
    assert.equal(rules.promptDocument(node).variants.red.english, english);
    assert.deepEqual([node.width, node.height, node.position], [original.width, original.height, original.position]);
    assert.equal(rules.isPromptReady(rules.promptDocument(node).variants.red), false);
    cleanup();
});
