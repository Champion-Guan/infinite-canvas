import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';

const modules = variantModules();
const rules = modules.load('Excel画布/产品变体规则.ts');
const generation = modules.load('画布生成/产品变体生成.ts');
const context = modules.load('components/canvas/canvas-node-generation.ts', true);
const retry = modules.load('提示词/生成文本读取.ts');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('2个变体按4张配置展开为8个独立任务，计入配置数量并按变体分列', () => {
    const f = variantFixture();
    const configs = Array.from({ length: 4 }, (_, index) => ({ ...f.config, id: `config-${index}`, position: { x: 800, y: index * 400 } }));
    f.nodes.push(...configs);
    f.connections.push(...configs.map(node => ({ id: node.id, fromNodeId: f.text.id, toNodeId: node.id })));
    const jobs = generation.planProductGenerationJobs(configs, f.nodes, f.connections, 'batch');
    assert.equal(jobs.length, 8);
    assert.equal(generation.productGenerationImageCount(jobs, '1'), 16);
    for (const id of ['red', 'blue']) {
        const selected = jobs.filter(job => job.placement.productVariant.snapshot.id === id);
        assert.equal(selected.length, 4);
        assert.equal(new Set(selected.map(job => job.placement.columnX)).size, 1);
        assert.equal(new Set(selected.map(job => job.source.id)).size, 4);
    }
    assert.ok(jobs[4].placement.columnX > jobs[0].placement.columnX + 340);
});

test('使用真实上下文组装与引用读取：不同变体只提交本变体图及显式共用图，提示词复用并替换变量', async () => {
    const f = variantFixture();
    f.parameter.metadata.productVariants[1].brief = { material: '涤纶' };
    f.parameter.metadata.productVariants[1].variableValues = { '[MATERIAL]': '涤纶' };
    const jobs = generation.planProductGenerationJobs([f.config], f.nodes, f.connections, 'batch');
    for (const job of jobs) {
        const execution = job.placement.productVariant;
        const scoped = generation.variantScopedNodes(f.nodes, execution);
        const built = context.buildNodeGenerationContext(job.source.id, scoped, f.connections, generation.variantInputPrompt(job.prompt, execution));
        const hydrated = await context.hydrateNodeGenerationContext(generation.variantGenerationContext(built, execution));
        assert.deepEqual(hydrated.referenceImages.map(image => image.storageKey), [`stored-${execution.snapshot.id}`, 'stored-shared']);
        assert.ok(hydrated.referenceImages.every(image => image.dataUrl.startsWith('data:image/png;base64,stored-')));
        assert.match(hydrated.prompt, new RegExp(`商品 ${execution.snapshot.name} 2件 ${execution.snapshot.id === 'blue' ? '涤纶' : '棉'}`));
        assert.doesNotMatch(hydrated.prompt, /旧颜色|商品 \[COLOR\]/);
        assert.match(hydrated.prompt, /本次只制作该变体/);
        assert.deepEqual(generation.productVariantResult({ productVariant: execution.snapshot }), execution.snapshot);
    }
});

test('变体快照独立于之后的编辑与删除，重试严格沿用结果卡保存的提示词及图片清单', () => {
    const f = variantFixture();
    const execution = generation.productVariantExecutions(f.config.id, f.nodes, f.connections)[0];
    const saved = generation.variantInputPrompt('展示 [COLOR] [COUNT]', execution);
    f.parameter.metadata.productBrief.material = '后来更改';
    f.parameter.metadata.productVariants[0].attributes.颜色 = '绿色';
    f.parameter.metadata.productMainImages.length = 0;
    assert.equal(execution.parameterMetadata.productBrief.material, '棉');
    assert.deepEqual(execution.parameterMetadata.productMainImages.map(image => image.id), ['red', 'shared']);
    assert.equal(execution.snapshot.attributes.颜色, '红色');
    assert.equal(retry.readProtectedRetryPrompt(saved, '新颜色\n\n【产品补充】\n新资料', true), saved);
});

test('全未勾选时批量跳过；空名称、重复名称、空配图及失效图片在任何任务开始前报错', () => {
    for (const [change, expected] of [
        [f => Object.assign(f.parameter.metadata.productVariants[0], { name: '', attributes: {} }), /填写变体名称/],
        [f => { f.parameter.metadata.productVariants[1].name = '红色'; }, /重复/],
        [f => { f.parameter.metadata.productVariants[1].imageIds = []; }, /分配产品主图/],
        [f => { f.parameter.metadata.productVariants[1].imageIds = ['missing']; }, /已被移除/],
        [f => { f.parameter.metadata.productMainImages[1] = { id: 'blue', name: '蓝图', url: 'blob:expired' }; }, /未保存/],
    ]) {
        const f = variantFixture(); change(f);
        assert.throws(() => generation.planProductGenerationJobs([f.config], f.nodes, f.connections, 'batch'), expected);
    }
    const disabled = variantFixture();
    disabled.parameter.metadata.productVariants.forEach(item => { item.enabled = false; });
    assert.deepEqual(generation.planProductGenerationJobs([disabled.config], disabled.nodes, disabled.connections, 'batch'), []);
});

test('遵守composer显式引用，停止媒体回溯，多个产品参数卡拒绝混图', () => {
    const f = variantFixture(), other = { ...f.parameter, id: 'other' };
    f.nodes.push(other, { id: 'result', type: 'image', metadata: {} });
    f.connections.push({ fromNodeId: other.id, toNodeId: 'result' }, { fromNodeId: 'result', toNodeId: f.config.id });
    assert.deepEqual(generation.generationProductParameters(f.config.id, f.nodes, f.connections).map(node => node.id), ['parameter']);
    f.connections.push({ fromNodeId: other.id, toNodeId: f.config.id });
    assert.throws(() => generation.productVariantExecutions(f.config.id, f.nodes, f.connections), /一张产品参数卡/);
    f.config.metadata.composerContent = '@[node:prompt]';
    assert.equal(generation.productVariantExecutions(f.config.id, f.nodes, f.connections).length, 2);
    f.config.metadata.composerContent = '不引用产品';
    assert.equal(generation.productVariantExecutions(f.config.id, f.nodes, f.connections).length, 0);
});

test('批次门控允许本批所有变体与子请求并行，阻止重复点击与其他批次交叉提交', () => {
    const { createCanvasGenerationRegistry } = modules.load('画布生成/并发生成状态.ts');
    const registry = createCanvasGenerationRegistry(), f = variantFixture();
    const jobs = generation.planProductGenerationJobs([f.config], f.nodes, f.connections, 'batch');
    assert.equal(generation.canStartVariantGeneration(registry.requests, 'config', jobs[0].placement), true);
    const controller = registry.startGenerationRequest('config', 'config', 'config', new AbortController(), 'config:variant:batch:red');
    registry.startGenerationRequest('child-red', 'config', 'config', controller);
    assert.equal(generation.canStartVariantGeneration(registry.requests, 'config', jobs[0].placement), false);
    assert.equal(generation.canStartVariantGeneration(registry.requests, 'config', jobs[1].placement), true);
    assert.equal(generation.canStartVariantGeneration(registry.requests, 'config', { ...jobs[1].placement, batchId: 'second' }), false);
    const affected = registry.stopGenerationRequests('config');
    assert.ok(affected.has('child-red')); assert.equal(controller.signal.aborted, true);
    assert.equal(generation.canStartVariantGeneration(registry.requests, 'config', jobs[1].placement), true);
});

test('单卡变体请求全部立即并发，重复点击不再提交，单个失败不阻止其他任务及最终保存', async () => {
    const gate = deferred(), calls = [], messages = [], f = variantFixture();
    let saved = 0;
    const loader = variantModules({
        './批量保存协调': { beginBatchCanvasSave() {}, finishBatchCanvasSave: () => true, completeBatchCanvasSave() {} },
    });
    const { useProductVariantGeneration } = loader.load('画布生成/产品变体执行.ts');
    const execute = useProductVariantGeneration({
        projectId: 'test', nodesRef: { current: f.nodes }, connectionsRef: { current: f.connections },
        generationRequestsRef: { current: new Map() }, count: '1', saveCanvas: async () => { saved++; },
        message: { info: text => messages.push(text), error: text => messages.push(text) },
        execute: async (id, mode, prompt, placement) => { calls.push(placement.productVariant.snapshot.id); await gate.promise; if (calls[0] === placement.productVariant.snapshot.id) throw Error('模拟失败'); },
    });
    const running = execute('config', 'image', '');
    assert.deepEqual(calls, ['red', 'blue']);
    await execute('config', 'image', '');
    assert.equal(calls.length, 2);
    gate.resolve(); await running;
    assert.equal(saved, 1); assert.ok(messages.some(text => text.includes('部分变体')));
});

test('按明确文件名前缀分组，可追加同变体图片，重复操作不重复加入，普通文件名不猜测', () => {
    const f = variantFixture(), images = [
        f.image('r1', '红色__正面.png'), f.image('r2', '红色__背面.png'),
        f.image('b1', '蓝色-front.jpg'), f.image('x', '随手拍.jpg'),
    ];
    const grouped = rules.groupVariantImagesByFilename(images, []);
    assert.equal(grouped.length, 2);
    assert.deepEqual(grouped[0].imageIds, ['r1', 'r2']);
    const twice = rules.groupVariantImagesByFilename(images, grouped);
    assert.deepEqual(twice, grouped);
    assert.equal(images.length, 4);
});
