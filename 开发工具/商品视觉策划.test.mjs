import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';

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
    for (const { value } of platformRules.PRODUCT_PLATFORM_OPTIONS.filter(option => option.value !== platformRules.WILDBERRIES_PLATFORM)) {
        parameter.metadata.productPlatform = value;
        parameter.metadata.productPlatformRules = platformRules.WILDBERRIES_RULES_TEXT;
        assert.equal(rules.productPlanningFacts(parameter.metadata).channelRequirements, '', value);
        const requirements = task.productPlanningRequirements(parameter.metadata);
        assert.equal(requirements.channelRules, '', value);
        assert.equal(requirements.production, null, value);
    }
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

test('重新策划更新未改卡片、保留手改卡片，旧配置退出批量且新卡片互不重叠', () => {
    const { fixture, rules, plan, canvas, fingerprint } = planned();
    const prompts = fixture.nodes.filter(node => rules.promptDocument(node));
    const oldId = prompts[0].id;
    rules.promptDocument(prompts[0]).variants.red.chinese += '手动修改';
    apply(fixture, canvas.productPlanOps(fixture.parameter, plan, fixture.nodes, fixture.connections, fingerprint));
    assert.equal(fixture.nodes.find(node => node.id === oldId).metadata.productPromptRetired, true);
    assert.match(rules.promptDocument(fixture.nodes.find(node => node.id === oldId)).variants.red.chinese, /手动修改/);
    assert.equal(fixture.nodes.filter(node => rules.promptDocument(node) && !node.metadata.productPromptRetired).length, 2);
    assert.equal(fixture.nodes.filter(node => node.type === 'config' && !node.metadata.productPromptRetired).length, 2);
    const cards = fixture.nodes.filter(node => node.id !== fixture.parameter.id);
    for (let i = 0; i < cards.length; i++) for (const b of cards.slice(i + 1)) {
        const a = cards[i];
        assert.ok(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x
            || a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y, `${a.id} overlaps ${b.id}`);
    }
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
    const prompt = fixture.nodes.find(node => rules.promptDocument(node));
    const pair = rules.promptDocument(prompt).variants.blue;
    pair.chinese += '新的修改';
    assert.throws(() => batch.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'batch'), /尚未同步/);
    pair.translatedChinese = pair.chinese;
    fixture.parameter.metadata.productBrief.material = '新材质';
    assert.throws(() => batch.planProductGenerationJobs(configs, fixture.nodes, fixture.connections, 'batch'), /资料或参考图已更改/);
});

test('策划服务记录并保存任务后落地，非法结果、旧资料与取消不会创建卡片；系统角色无平台污染', async () => {
    let incoming, failSave = false, cancelled = false, mutateSource = false;
    const fixture = variantFixture(); fixture.nodes = [fixture.parameter]; fixture.connections = [];
    let ops = 0, saves = 0;
    const loader = modules({
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({ config: { channels: [] }, isAiConfigReady: () => true }) }, encodeChannelModel: () => 'image-model' },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: () => ({ model: 'vision' }) },
        '../产品/产品操作': { saveProductCanvas: async () => { saves++; return { persisted: !failSave }; } },
        '../画布生成/原画布文本调用': { requestCanvasText: async options => {
            incoming = options;
            await options.recordTask({ slotId: options.scope.slotId, taskId: 'mock-task' });
            if (cancelled) controller.abort();
            if (mutateSource) fixture.parameter.metadata.productBrief.nameCategory += '变更';
            return options.applyAndSave(JSON.stringify(planData(['red', 'blue'])), { taskId: 'mock-task' });
        } },
    });
    const ctx = { node: fixture.parameter, getNode: id => fixture.nodes.find(node => node.id === id),
        getNodes: () => fixture.nodes, getConnections: () => fixture.connections,
        updateMetadata: patch => { fixture.parameter.metadata = { ...fixture.parameter.metadata, ...patch }; },
        applyOps: value => { ops++; apply(fixture, value); } };
    let controller = new AbortController();
    const service = loader.load('Excel画布/商品策划请求.ts');
    await service.planProductImages(ctx, 'product', controller.signal);
    assert.equal(ops, 1); assert.equal(saves, 2);
    assert.doesNotMatch(incoming.messages[0].content, /Wildberries|1800|2400/);
    assert.match(incoming.messages[1].content[0].text, /Wildberries/);
    failSave = true;
    await assert.rejects(service.planProductImages(ctx, 'product', controller.signal), /保存尚未确认/);
    assert.equal(ops, 1); failSave = false; mutateSource = true;
    await assert.rejects(service.planProductImages(ctx, 'product', controller.signal), /资料或参考图已更改/);
    assert.equal(ops, 1); mutateSource = false; cancelled = true; controller = new AbortController();
    await assert.rejects(service.planProductImages(ctx, 'product', controller.signal), error => error.name === 'AbortError');
    assert.equal(ops, 1);
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
