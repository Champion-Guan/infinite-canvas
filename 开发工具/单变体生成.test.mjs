import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';
import { canvasTaskSummary } from '../扩展功能/产品/产品任务摘要.js';
import { readCanvasCapsuleStatus } from '../扩展功能/产品/旧版产品胶囊状态.js';

function fixture(overrides = {}) {
    let loader;
    loader = variantModules({
        '@/lib/canvas/node-registry': { getNodeDefinition: type => type === 'guan:product-prompt'
            ? { resource: node => ({ kind: 'text', text: loader.load('Excel画布/商品提示词规则.ts').promptPair(
                loader.load('Excel画布/商品提示词规则.ts').promptDocument(node)).english }) } : undefined },
        ...overrides,
    });
    const f = variantFixture(), rules = loader.load('Excel画布/商品提示词规则.ts');
    const pair = name => ({ chinese: `保留${name}旅行包原样，展示完整商品及背带。`,
        english: `Photograph the actual ${name} travel bag from its own reference photos. Preserve the exact shape, material, seams and included strap, using soft daylight and a clean background.`,
        translatedChinese: `保留${name}旅行包原样，展示完整商品及背带。` });
    const pairs = { red: pair('red'), blue: pair('blue') };
    f.text.type = 'guan:product-prompt';
    f.text.metadata = { productImagePrompt: { key: 'main', kind: 'main', name: '主图', parameterId: f.parameter.id,
        delivery: { width: 800, height: 800, format: 'png', maxMB: 10 }, prompt: pairs.red, variants: pairs },
        productPromptSourceFingerprint: rules.planningFingerprint(f.parameter.metadata) };
    f.config.metadata.productPromptConfigKey = f.text.id;
    return { ...f, loader, rules, single: loader.load('画布生成/单变体生成.ts') };
}

test('仅规划当前变体，沿用其配置、英文和参考图，结果避开已有图片并落在配置右侧', () => {
    const f = fixture();
    f.config.metadata.productPromptVariantConfigs = { base: { count: 2 }, variants: { blue: { count: 3 } } };
    f.nodes.push({ id: 'old-result', type: 'image', position: { x: 1180, y: 0 }, width: 340, height: 240, metadata: {} });
    const before = structuredClone(f.nodes);
    const job = f.single.planSingleProductVariantJob({ promptNodeId: f.text.id, variantId: 'blue' }, f.nodes, f.connections, 'single');
    assert.equal(job.source.id, f.config.id);
    assert.equal(job.source.metadata.count, 3);
    assert.equal(job.placement.productVariant.snapshot.id, 'blue');
    assert.ok(job.placement.columnX > 1520);
    assert.equal(job.placement.centerY, f.config.position.y + f.config.height / 2);
    const context = f.loader.load('画布生成/商品提示词生成.ts').buildProductGenerationContext(
        job.source.id, f.nodes, f.connections, job.prompt, job.placement.productVariant);
    assert.match(context.prompt, /actual blue travel bag/);
    assert.doesNotMatch(context.prompt, /actual red travel bag/);
    assert.deepEqual(context.referenceImages.map(image => image.storageKey), ['stored-blue', 'stored-shared']);
    assert.deepEqual(f.nodes, before);
});

test('未勾选变体仍可单独生成，只检查当前变体，批量仍跳过未勾选变体', () => {
    const f = fixture();
    f.parameter.metadata.productVariants[1].enabled = false;
    f.text.metadata.productPromptSourceFingerprint = f.rules.planningFingerprint(f.parameter.metadata);
    f.text.metadata.productImagePrompt.variants.red.translationError = '网络连接失败';
    // 配图检查留给所选变体，未选中的坏资料不应阻止本次明确操作。
    f.parameter.metadata.productVariants[0].imageIds = [];
    f.text.metadata.productPromptSourceFingerprint = f.rules.planningFingerprint(f.parameter.metadata);
    const job = f.single.planSingleProductVariantJob({ promptNodeId: f.text.id, variantId: 'blue' }, f.nodes, f.connections, 'single');
    assert.equal(job.placement.productVariant.snapshot.id, 'blue');
    assert.equal(f.parameter.metadata.productVariants[1].enabled, false);
    f.parameter.metadata.productVariants[0].enabled = false;
    assert.deepEqual(f.loader.load('画布生成/产品变体生成.ts').planProductGenerationJobs([f.config], f.nodes, f.connections, 'batch'), []);
    assert.throws(() => f.single.planSingleProductVariantJob({ promptNodeId: f.text.id, variantId: 'red' }, f.nodes, f.connections, 'single'), /分配产品主图/);
});

test('缺配置、多配置、未引用当前卡、失效翻译和删除的变体都在提交前拒绝', () => {
    for (const [change, error] of [
        [f => { f.connections.length = 1; }, /连接一个生图配置/],
        [f => { f.nodes.push({ ...f.config, id: 'other' }); f.connections.push({ fromNodeId: f.text.id, toNodeId: 'other' }); }, /多个生图配置/],
        [f => { f.config.metadata.composerContent = '不用关联提示词'; }, /仅引用当前/],
        [f => { f.text.metadata.productImagePrompt.variants.blue.translatedChinese = ''; }, /尚未同步/],
        [f => { f.parameter.metadata.productVariants.pop(); }, /已移除/],
    ]) {
        const f = fixture(); change(f);
        assert.throws(() => f.single.planSingleProductVariantJob({ promptNodeId: f.text.id, variantId: 'blue' }, f.nodes, f.connections, 'single'), error);
    }
});

test('单变体入口复用原执行与保存，阻止重复及批量交叉提交，胶囊汇总运行和结果', async t => {
    const cleanups = [], calls = [];
    let release, saves = 0, submitted = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const f = fixture({
        react: { useRef: current => ({ current }), useCallback: callback => callback, useEffect: callback => { cleanups.push(callback()); } },
        './批量保存协调': { beginBatchCanvasSave() {}, finishBatchCanvasSave: () => true, completeBatchCanvasSave() {} },
    });
    t.after(() => cleanups.forEach(cleanup => cleanup?.()));
    const execute = f.loader.load('画布生成/产品变体执行.ts').useProductVariantGeneration({
        projectId: 'single-product', nodesRef: { current: f.nodes }, connectionsRef: { current: f.connections },
        generationRequestsRef: { current: new Map() }, count: '1', message: { info() {}, error() {} },
        saveCanvas: async () => { saves++; },
        execute: async (id, mode, prompt, placement) => {
            calls.push({ id, mode, variant: placement.productVariant.snapshot.id });
            placement.onSubmitted?.();
            placement.onSubmitted?.();
            f.config.metadata = { ...f.config.metadata, generationStartedAt: 100, status: 'loading' };
            const result = { id: 'single-result', type: 'image', position: { x: placement.columnX, y: placement.centerY - 120 },
                width: 340, height: 240, metadata: { generationStartedAt: 100, status: 'loading', productVariant: placement.productVariant.snapshot } };
            f.nodes.push(result); f.connections.push({ fromNodeId: id, toNodeId: result.id });
            await pending;
            f.config.metadata.status = result.metadata.status = 'success';
        },
    });
    const job = f.single.generateSingleProductVariant('single-product', { promptNodeId: f.text.id, variantId: 'blue', onSubmitted: () => { submitted++; } });
    assert.deepEqual(calls, [{ id: 'config', mode: 'image', variant: 'blue' }]);
    assert.equal(submitted, 1);
    assert.equal(canvasTaskSummary(f.nodes, f.connections).status, 'loading');
    await assert.rejects(f.single.generateSingleProductVariant('single-product', { promptNodeId: f.text.id, variantId: 'red' }), /正在生成/);
    await execute('config', 'image', '');
    assert.equal(calls.length, 1);
    release(); await job;
    assert.equal(saves, 1);
    const summary = canvasTaskSummary(f.nodes, f.connections, true);
    assert.equal(summary.status, 'success');
    const storage = { getItem: key => key === 'guan-canvas-status:single-product' ? JSON.stringify(summary) : null };
    assert.equal(readCanvasCapsuleStatus('single-product', false, storage), 'success');
    f.nodes.find(node => node.id === 'single-result').metadata.status = 'error';
    assert.equal(canvasTaskSummary(f.nodes, f.connections).status, 'error');
    assert.equal(readCanvasCapsuleStatus('another-product', false, storage), 'idle');
});

test('按产品作用域注册和卸载，迟到的旧清理不移除新画布入口', async () => {
    const f = fixture(), calls = [];
    const unregisterOld = f.single.registerSingleVariantGeneration('product', async () => { calls.push('old'); });
    const unregisterNew = f.single.registerSingleVariantGeneration('product', async () => { calls.push('new'); });
    unregisterOld();
    await f.single.generateSingleProductVariant('product', { promptNodeId: 'prompt' });
    assert.deepEqual(calls, ['new']);
    unregisterNew();
    await assert.rejects(f.single.generateSingleProductVariant('product', { promptNodeId: 'prompt' }), /尚未就绪/);
});

test('卡片底部按钮按当前页签提交一次，生成中禁用，失败后恢复并显示可重试原因', async () => {
    const cells = [], effects = [], calls = [], errors = [];
    let cursor = 0, dirty = false, reject, resolve, submitted;
    let pending = new Promise((_resolve, fail) => { reject = fail; });
    const jsx = (type, props) => ({ type, props: props || {} });
    const react = {
        useRef(current) { const id = cursor++; return cells[id] ||= { current }; },
        useState(initial) { const id = cursor++; if (!(id in cells)) cells[id] = initial;
            return [cells[id], value => { cells[id] = typeof value === 'function' ? value(cells[id]) : value; dirty = true; }]; },
        useEffect(callback, deps) { const id = cursor++, previous = cells[id];
            if (!previous || deps.some((value, index) => value !== previous[index])) { cells[id] = deps; effects.push(callback); } },
    };
    const f = fixture({ react, 'react/jsx-runtime': { jsx, jsxs: jsx },
        '@/stores/use-config-store': { useEffectiveConfig: () => ({ count: '4', canvasImageCount: '5' }) },
        antd: { App: { useApp: () => ({ message: { error: value => errors.push(value) } }) } },
        'lucide-react': { Play: 'Play', LoaderCircle: 'LoaderCircle' },
        '../主题/苹果交互按钮': { AppleAntButton: 'button' },
        '../画布生成/单变体生成': { generateSingleProductVariant: (productId, request) => {
            submitted = request.onSubmitted;
            calls.push({ productId, promptNodeId: request.promptNodeId, variantId: request.variantId });
            return pending;
        } },
    });
    const component = f.loader.load('Excel画布/商品变体生成按钮.tsx').ProductVariantGenerateButton;
    const elements = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(elements)];
    const ctx = { node: f.text, getNode: id => f.nodes.find(node => node.id === id), getConnections: () => f.connections,
        applyOps(items) { for (const item of items) {
            const node = f.nodes.find(node => node.id === item.id);
            node.metadata = { ...node.metadata, ...item.metadata };
        } } };
    const render = variantId => {
        let tree;
        do {
            dirty = false; cursor = 0; effects.length = 0;
            tree = component({ ctx, productId: 'product', variantId });
            effects.forEach(callback => callback());
        } while (dirty);
        assert.match(tree.props.className, /shrink-0/);
        return elements(tree).find(element => element.type === 'button');
    };
    let button = render('blue');
    assert.equal(button.props['aria-label'], '仅生成蓝色');
    assert.ok(elements(button).some(element => element.props.children === '生成 · 蓝色 · 共 2 张'));
    f.config.metadata.count = 3;
    button = render('blue');
    assert.ok(elements(button).some(element => element.props.children === '生成 · 蓝色 · 共 3 张'));
    button.props.onClick(); button.props.onClick();
    assert.deepEqual(calls, [{ productId: 'product', promptNodeId: 'prompt', variantId: 'blue' }]);
    button = render('red');
    assert.equal(button.props.disabled, true);
    assert.ok(elements(button).some(element => element.props.children === '正在生成 · 蓝色 · 共 3 张'));
    reject(Error('网络连接失败，请重试。'));
    await new Promise(resolve => setImmediate(resolve));
    button = render('red');
    assert.equal(button.props.disabled, false);
    assert.equal(f.parameter.metadata.productVariants[1].enabled, true);
    assert.equal(button.props['aria-label'], '仅生成红色');
    f.config.metadata.productPromptVariantConfigs = { base: { count: 3 }, variants: { blue: { count: 7 } } };
    assert.ok(elements(render('blue')).some(element => element.props.children === '生成 · 蓝色 · 共 7 张'));
    delete f.config.metadata.count;
    assert.ok(elements(render('red')).some(element => element.props.children === '生成 · 红色 · 共 5 张'));
    assert.deepEqual(errors, ['网络连接失败，请重试。']);
    pending = new Promise(done => { resolve = done; });
    render('blue').props.onClick();
    assert.equal(f.parameter.metadata.productVariants[1].enabled, true);
    render('red');
    submitted();
    assert.equal(f.parameter.metadata.productVariants[1].enabled, false);
    assert.equal(f.parameter.metadata.productVariants[0].enabled, true);
    assert.equal(render('blue').props.disabled, true, '生成中仍禁用');
    resolve(); await new Promise(done => setImmediate(done));
    assert.equal(render('blue').props.disabled, false, '未勾选不影响再次单独生成');
    assert.match(render('blue').props.title, /仅生成蓝色/);
    pending = new Promise(done => { resolve = done; });
    render('blue').props.onClick();
    // 回执之后用户手动重新勾选，任务完成时不得再次取消。
    submitted();
    f.parameter.metadata.productVariants[1].enabled = true;
    resolve(); await new Promise(done => setImmediate(done));
    assert.equal(f.parameter.metadata.productVariants[1].enabled, true);
});
