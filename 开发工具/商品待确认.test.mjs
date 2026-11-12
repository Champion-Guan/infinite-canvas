import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { buildFragmentPlan } from '../扩展功能/本机存储/分片值编码.mjs';
import { serializeDocument } from '../扩展功能/本机存储/协议.mjs';
import { designProtocolPlan } from './商品策划响应夹具.mjs';

const fields = [
    { id: 'load', label: '实测承重', question: '请填写实测承重及范围。', kind: 'number', unit: 'kg', scope: 'shared',
        scopes: [{ value: 'whole', chinese: '整架', english: 'whole rack' }, { value: 'single', chinese: '单层', english: 'one shelf' }],
        imageKeys: ['load-view'], fallback: '承重未填写，本图展示可见的支撑结构，不展示承重。' },
    { id: 'brakes', label: '是否带刹车', question: '销售款是否带刹车？', kind: 'choice', unit: '', scope: 'variant', scopes: [],
        imageKeys: ['wheel-view'], fallback: '刹车未知，只展示可见脚轮，不制作刹车教程。' },
    { id: 'back', label: '背面实拍', question: '请补充对应变体的背面实拍。', kind: 'image', unit: '', scope: 'variant', scopes: [],
        imageKeys: ['load-view'], fallback: '没有背面图时保留正面结构方案。' },
    { id: 'evidence', label: '宣传依据', question: '请提供测试条件与依据。', kind: 'supplement', unit: '', scope: 'shared', scopes: [],
        imageKeys: ['load-view'], fallback: '依据未核对，不使用性能宣传。' },
];
const condition = field => field.id === 'load'
    ? { factId: 'load', unknown: { chinese: '展示参考图可见的支撑结构，不放重物，不写承重。', english: 'Show the visible support structure from the reference photo. Add no heavy objects or load-capacity claim.' },
        known: { chinese: '标注{{scope}}实测承重{{value}}{{unit}}，不增加其他性能宣传。', english: 'Label the measured {{scope}} load capacity as {{value}}{{unit}}. Add no other performance claims.' } }
    : { factId: 'brakes', unknown: { chinese: '仅展示实拍可见的脚轮，未确认刹车，不画刹车操作。', english: 'Show only the casters visible in the reference. Brake availability is unknown; do not depict brake operation.' },
        yes: { chinese: '展示实拍中的刹车部件，不改动外观。', english: 'Show the brake component visible in the reference photo without changing its appearance.' },
        no: { chinese: '展示无刹车脚轮，不添加刹车结构。', english: 'Show casters without brakes. Do not add brake components or a brake tutorial.' } };
const pair = field => ({ chinese: `暖白背景，按实物拍摄。{{fact:${field.id}}}`, english: `Use a warm white background and photograph the actual product. {{fact:${field.id}}}`,
    translatedChinese: `暖白背景，按实物拍摄。{{fact:${field.id}}}`, conditionalTemplate: JSON.stringify([condition(field)]) });
const planPair = field => ({ chinese: pair(field).chinese, english: pair(field).english, conditions: [condition(field)] });
function fixture(overrides = {}) {
    const loader = variantModules({
        '@/lib/canvas/node-registry': { getNodeDefinition: type => type === 'guan:product-prompt'
            ? { resource: node => ({ kind: 'text', text: node.metadata.productImagePrompt.prompt.english }) }
            : type === 'guan:prompt-variables' ? { resource: node => loader.load('Excel画布/旧版参数规则.ts').promptVariablesResource(node) } : undefined },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: config => ({ ...config, model: 'synthetic-text' }), getGenerationCount: value => Number(value || 1) },
        ...overrides,
    }), base = variantFixture();
    base.parameter.metadata.productImagePlan = { pendingFacts: fields.map(item => item.question), confirmations: structuredClone(fields),
        imageCount: 2, overview: {}, assumptions: [], style: '', updatedAt: '', preserved: 0 };
    const rules = loader.load('Excel画布/商品提示词规则.ts'), confirmations = loader.load('Excel画布/商品待确认规则.ts');
    const compile = loader.load('Excel画布/商品待确认提示词.ts');
    const prompts = fields.slice(0, 2).map((field, index) => ({ id: `p-${field.id}`, type: 'guan:product-prompt', title: field.label,
        position: { x: 500, y: index * 600 }, width: 440, height: 540, metadata: { status: 'success',
            productPromptSourceFingerprint: rules.planningFingerprint(base.parameter.metadata),
            productImagePrompt: { parameterId: base.parameter.id, key: index ? 'wheel-view' : 'load-view', kind: 'carousel', name: field.label,
                buyerQuestion: '买家问题', evidence: '实物依据', composition: '柔光正面', constraints: '不改外观', copyLayout: '按条件标注', checks: '核对实拍和文字',
                delivery: { width: 1800, height: 2400, format: 'png', maxMB: 10 }, generatedSignature: '',
                prompt: pair(field), variants: { red: pair(field), blue: pair(field) } } } }));
    const configs = prompts.map(prompt => ({ id: `c-${prompt.id}`, type: 'config', metadata: { productPromptConfigKey: prompt.id, generationMode: 'image' } }));
    const nodes = [base.parameter, ...prompts, ...configs], connections = prompts.map((prompt, i) => ({ id: prompt.id, fromNodeId: prompt.id, toNodeId: configs[i].id }));
    const applyOps = ops => {
        for (const op of ops) if (op.type === 'update_node') {
            const node = nodes.find(node => node.id === op.id);
            Object.assign(node, op.patch || {}); node.metadata = { ...node.metadata, ...op.metadata };
        }
    };
    const ctx = { node: base.parameter, getNode: id => nodes.find(node => node.id === id), getNodes: () => nodes, getConnections: () => connections,
        updateMetadata: patch => { base.parameter.metadata = { ...base.parameter.metadata, ...patch }; }, applyOps };
    const answer = (field, value, variantId, extra = {}) => ctx.updateMetadata(confirmations.confirmationAnswerPatch(base.parameter.metadata,
        fields.find(item => item.id === field), variantId, { value, ...extra }));
    return { ...base, nodes, connections, prompts, configs, loader, rules, confirmations, compile, ctx, answer };
}
function outputPlan(f) {
    return { overview: { buyers: '买家', sellingPoints: '真实卖点', concerns: '顾虑', consistency: '外观不变', sequence: '按规划' },
        style: '柔光实拍', pendingFacts: fields.map(item => item.question), assumptions: [], confirmations: fields,
        images: f.prompts.map((node, i) => ({ ...node.metadata.productImagePrompt,
            prompt: planPair(fields[i]), variants: { red: planPair(fields[i]), blue: planPair(fields[i]) } })) };
}

test('待确认的数值、选项、照片和依据协议可解析；缺少条件、假字段及不完整分支不落地', () => {
    const f = fixture(), data = outputPlan(f);
    const plan = f.rules.parseProductImagePlan(JSON.stringify(data), ['red', 'blue']);
    assert.equal(plan.confirmations.length, 4); assert.equal(typeof plan.images[0].prompt.conditionalTemplate, 'string');
    for (const mutate of [
        value => { delete value.images[0].prompt.conditions; },
        value => { value.images[0].prompt.conditions[0].factId = 'missing'; },
        value => { value.images[0].prompt.conditions[0].unknown.chinese = ''; },
        value => { value.images[0].prompt.conditions[0].known.english = 'Guess a load number.'; },
        value => { delete value.images[1].prompt.conditions[0].no; },
        value => { value.confirmations[0].imageKeys = ['not-a-plan-key']; },
    ]) {
        const bad = structuredClone(data); mutate(bad);
        assert.throws(() => f.rules.parseProductImagePlan(JSON.stringify(bad), ['red', 'blue']), /待确认/);
    }
});

test('未填写在工作台确定保守方案，提交文本没有变量或假承重；填入0也有效，清空可撤回', () => {
    const f = fixture(), doc = f.prompts[0].metadata.productImagePrompt;
    const unknown = f.compile.compileConfirmationPair(doc.prompt, f.parameter.metadata, doc.key);
    assert.match(unknown.pair.english, /no heavy objects/);
    assert.doesNotMatch(unknown.pair.english, /\{\{|〔|\d+\s*kg\b/);
    const preview = f.compile.compileConfirmationPair(doc.prompt, f.parameter.metadata, doc.key, undefined, true);
    assert.match(preview.pair.chinese, /〔实测承重〕/);
    f.answer('load', '8', undefined, { scope: 'whole' });
    const filled = f.compile.compileConfirmationPair(doc.prompt, f.parameter.metadata, doc.key);
    assert.match(filled.pair.chinese, /整架实测承重8kg/); assert.match(filled.pair.english, /whole rack.*8kg/);
    assert.equal(filled.pair.translatedChinese, filled.pair.chinese);
    f.answer('load', '0', undefined, { scope: 'single' });
    assert.match(f.compile.compileConfirmationPair(doc.prompt, f.parameter.metadata, doc.key).pair.english, /one shelf.*0kg/);
    for (const value of ['', '未知', '10kg', '-1', 'Infinity']) {
        f.answer('load', value, undefined, { scope: 'whole' });
        assert.equal(f.compile.compileConfirmationPair(doc.prompt, f.parameter.metadata, doc.key).pair.english, unknown.pair.english);
    }
    assert.equal(doc.prompt.chinese, pair(fields[0]).chinese, '原模板不被替换掉');
});

test('有/无/未知独立分支且变体隔离，共用参数只填一次，新增照片仅引用对应图片和变体', () => {
    const f = fixture(), doc = f.prompts[1].metadata.productImagePrompt;
    f.answer('brakes', 'no', 'red');
    assert.match(f.compile.compileConfirmationPair(doc.variants.red, f.parameter.metadata, doc.key, 'red').pair.english, /without brakes/);
    assert.match(f.compile.compileConfirmationPair(doc.variants.blue, f.parameter.metadata, doc.key, 'blue').pair.english, /availability is unknown/);
    f.answer('brakes', 'yes', 'blue');
    assert.match(f.compile.compileConfirmationPair(doc.variants.blue, f.parameter.metadata, doc.key, 'blue').pair.english, /brake component visible/);
    f.answer('brakes', 'unknown', 'red');
    assert.match(f.compile.compileConfirmationPair(doc.variants.red, f.parameter.metadata, doc.key, 'red').pair.english, /availability is unknown/);
    const load = f.prompts[0].metadata.productImagePrompt;
    f.answer('back', '', 'red', { images: [{ id: 'red-back', name: '红色背面', storageKey: 'file:red-back' }] });
    load.confirmationImageIds = ['red-back'];
    assert.equal(f.compile.confirmationImageReferences(f.parameter.metadata, load, 'red').length, 1);
    assert.equal(f.compile.confirmationImageReferences(f.parameter.metadata, load, 'blue').length, 0);
    assert.equal(f.compile.confirmationImageReferences(f.parameter.metadata, doc, 'red').length, 0);
    assert.deepEqual(f.parameter.metadata.productMainImages.map(item => item.id), ['red', 'blue', 'shared', 'unused']);
    assert.throws(() => f.compile.validateConfirmationImages(f.parameter.metadata, { ...doc, confirmationImageIds: ['red-back'] }), /关联范围/);
    const available = f.compile.confirmationPlanningImages(f.parameter.metadata, ['wheel-view']);
    assert.equal(available.length, 0, '其他卡片的策划请求不附本项照片');
    assert.throws(() => f.answer('brakes', 'yes', 'removed'), /变体/);
});

test('填写不使整套策划失效，事项专属依据与旧格式补充均不会进入全局文本，变体依据独立', () => {
    const f = fixture(), fingerprint = f.rules.planningFingerprint(f.parameter.metadata);
    f.answer('load', '8', undefined, { scope: 'whole' });
    assert.equal(f.rules.planningFingerprint(f.parameter.metadata), fingerprint);
    const field = fields[3], initial = f.parameter.metadata.promptVariableSupplement || '';
    const block = f.confirmations.appendConfirmationEvidence(initial, field);
    f.parameter.metadata.promptVariableSupplement = block.replace('】\n\n【/', '】\n供应商补充的测试说明\n【/');
    assert.equal(f.rules.planningFingerprint(f.parameter.metadata), fingerprint);
    assert.match(f.compile.confirmationPlanInputs(f.parameter.metadata).find(item => item.id === field.id).evidence, /测试说明/);
    const global = f.loader.load('Excel画布/旧版参数规则.ts').productParameterSupplement(f.parameter.metadata);
    assert.doesNotMatch(global, /测试说明|待确认依据/);
    f.answer('brakes', 'unknown', 'red', { evidence: '红款独有测试条件' });
    const inputs = f.compile.confirmationPlanInputs(f.parameter.metadata);
    assert.equal(inputs.find(item => item.id === 'brakes').answers.find(item => item.variantId === 'red').evidence, '红款独有测试条件');
    assert.equal(inputs.find(item => item.id === 'brakes').answers.find(item => item.variantId === 'blue').evidence, '');
    assert.doesNotMatch(f.loader.load('Excel画布/旧版参数规则.ts').productParameterSupplement(f.parameter.metadata), /红款独有测试条件/);
    f.parameter.metadata.promptVariableSupplement += '\n改变背景要求';
    assert.notEqual(f.rules.planningFingerprint(f.parameter.metadata), fingerprint);
});

test('实际待确认表单分别更新关联卡片和专属依据，关闭确认保存，不触发生成或改变全局资料', async () => {
    const cells = []; let cursor = 0;
    const saved = [];
    const jsx = (type, props) => ({ type, props });
    const f = fixture({
        react: { useEffect() {}, useRef: current => ({ current }), useState: value => {
            const index = cursor++; if (!(index in cells)) cells[index] = typeof value === 'function' ? value() : value;
            return [cells[index], next => { cells[index] = next; }];
        } },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        antd: { Button: 'Button', Checkbox: 'Checkbox', Input: Object.assign('Input', { TextArea: 'TextArea' }), Segmented: 'Segmented' },
        'lucide-react': {}, '../主题/苹果弹窗': { AppleModal: 'Modal' }, '../媒体交付/媒体缩略图': { MediaThumbnail: 'Thumbnail' },
        './产品选项下拉': { ProductOptionSelect: 'Select' },
        './参数图片预览': { ParameterImageThumbnail: 'ParameterImageThumbnail' },
        '../产品/产品操作': { saveProductCanvas: async productId => { saved.push(productId); return { persisted: true }; } },
    });
    f.ctx.theme = { node: {} };
    f.parameter.metadata.promptVariableSupplement = '全局背景说明';
    const originals = structuredClone(f.prompts), mainPhotos = structuredClone(f.parameter.metadata.productMainImages);
    const component = f.loader.load('Excel画布/商品待确认编辑.tsx');
    const row = () => {
        cursor = 0;
        const tree = component.ProductConfirmationList({ ctx: f.ctx, productId: 'product', onlyField: 'evidence' });
        const item = tree.props.children[0];
        return item.type(item.props);
    };
    const flatten = item => item && typeof item === 'object' ? [item, ...[item.props?.children].flat(Infinity).flatMap(flatten)] : [];
    let controls = flatten(row());
    controls.find(item => item.type === 'Checkbox' && item.props['aria-label'].endsWith('是否带刹车')).props.onChange({ target: { checked: true } });
    controls = flatten(row());
    assert.deepEqual(f.parameter.metadata.productImagePlan.confirmations.find(item => item.id === 'evidence').imageKeys, ['load-view', 'wheel-view']);
    controls.find(item => item.type === 'Button' && item.props.children === '补充依据').props.onClick();
    controls = flatten(row());
    assert.equal(controls.find(item => item.type === 'Modal').props.open, true);
    controls.find(item => item.type === 'TextArea').props.onChange({ target: { value: '仅这两张图的测试条件' } });
    assert.equal(f.confirmations.confirmationAnswer(f.parameter.metadata, fields[3]).evidence, '仅这两张图的测试条件');
    assert.equal(f.parameter.metadata.promptVariableSupplement, '全局背景说明');
    assert.deepEqual(f.parameter.metadata.productMainImages, mainPhotos);
    assert.deepEqual(f.prompts, originals);
    controls.find(item => item.type === 'Modal').props.onCancel();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(saved, ['product']);
    assert.equal(flatten(row()).find(item => item.type === 'Modal').props.open, false);
    assert.equal(f.confirmations.confirmationAnswer(f.parameter.metadata, fields[3]).evidence, '仅这两张图的测试条件');
});

test('编辑普通文本保留模板，高亮条件片段不允许误删；中英文高亮范围指向实际值', () => {
    const f = fixture(), source = f.prompts[0].metadata.productImagePrompt.prompt;
    f.answer('load', '8', undefined, { scope: 'whole' });
    const result = f.compile.compileConfirmationPair(source, f.parameter.metadata, 'load-view', undefined, true);
    const ranges = result.ranges.chinese;
    assert.equal(result.pair.chinese.slice(ranges[0].start, ranges[0].end), '8');
    const changed = result.pair.chinese.replace('暖白', '浅灰');
    assert.equal(f.compile.editConfirmationTemplate(result.pair.chinese, changed, result.sections.chinese), source.chinese.replace('暖白', '浅灰'));
    assert.throws(() => f.compile.editConfirmationTemplate(result.pair.chinese, result.pair.chinese.replace('8kg', '12kg'), result.sections.chinese), /高亮片段/);
});

test('真实生成上下文只使用解析后文本与对应参考图；在途快照不随之后的答案改变', () => {
    const f = fixture(), context = f.loader.load('画布生成/商品提示词生成.ts'), variants = f.loader.load('画布生成/产品变体生成.ts');
    f.answer('load', '8', undefined, { scope: 'whole' });
    f.answer('back', '', 'red', { images: [{ id: 'red-back', name: '背面', storageKey: 'file:red-back' }] });
    f.prompts[0].metadata.productImagePrompt.confirmationImageIds = ['red-back'];
    const execution = variants.productVariantExecutions(f.configs[0].id, f.nodes, f.connections)[0];
    const prepared = context.buildProductGenerationContext(f.configs[0].id, f.nodes, f.connections, '', execution);
    assert.match(prepared.prompt, /8kg/); assert.doesNotMatch(prepared.prompt, /\{\{fact:/);
    assert.ok(prepared.referenceImages.some(item => item.id === 'red-back'));
    const unrelated = context.buildProductGenerationContext(f.configs[1].id, f.nodes, f.connections, '',
        variants.productVariantExecutions(f.configs[1].id, f.nodes, f.connections)[0]);
    assert.ok(!unrelated.referenceImages.some(item => item.id === 'red-back'));
    f.answer('load', '12', undefined, { scope: 'whole' });
    const later = context.buildProductGenerationContext(f.configs[0].id, f.nodes, f.connections, '', variants.productVariantExecutions(f.configs[0].id, f.nodes, f.connections)[0]);
    assert.match(later.prompt, /12kg/); assert.match(prepared.prompt, /8kg/);
    f.answer('back', '', 'red', { images: [] });
    assert.throws(() => context.buildProductGenerationContext(f.configs[0].id, f.nodes, f.connections, '', execution), /参考图已移除/);
});

test('待确认上传复用上传服务，逐张读取最新答案；取消或原卡变化不写入迟到图片', async () => {
    const f = fixture(), { uploadConfirmationFiles } = f.loader.load('Excel画布/商品待确认上传.ts');
    const files = [new File(['photo'], '背面.jpg', { type: 'image/jpeg' })], controller = new AbortController();
    await uploadConfirmationFiles({ ctx: f.ctx, productId: 'product', field: fields[2], variantId: 'red', files, signal: controller.signal,
        upload: async (_file, options) => { assert.equal(options.assetProjectId, 'product'); return { storageKey: 'stored:photo' }; } });
    assert.equal(f.confirmations.confirmationAnswer(f.parameter.metadata, fields[2], 'red').images.length, 1);
    await assert.rejects(uploadConfirmationFiles({ ctx: f.ctx, productId: 'product', field: fields[2], variantId: 'red', files, signal: controller.signal,
        upload: async () => { controller.abort(); return { storageKey: 'stored:late' }; } }), error => error.name === 'AbortError');
    assert.equal(f.confirmations.confirmationAnswer(f.parameter.metadata, fields[2], 'red').images.length, 1);
});

test('变量、模板和照片关联通过完整应用命名空间持久化，恢复后仍能解析与清空', async () => {
    const f = fixture(), codec = createValueCodec({ client: {} });
    f.answer('load', '8', undefined, { scope: 'whole' });
    f.answer('back', '', 'red', { images: [{ id: 'red-back', name: '背面', storageKey: 'file:red-back' }], evidence: '红色背面实拍说明' });
    f.prompts[0].metadata.productImagePrompt.confirmationImageIds = ['red-back'];
    try {
        const value = { state: { projects: [{ id: 'product', nodes: f.nodes, connections: f.connections }], deletedProjects: [] }, version: 0 };
        const encoded = await codec.encode(value);
        const namespace = await buildFragmentPlan([['infinite-canvas:canvas_store', encoded]]);
        for (const [id, document] of namespace.fragments)
            serializeDocument('extension', id, document.value, document.mediaIds);
        const restored = await codec.decode(encoded.tree);
        assert.deepEqual(restored, value);
        const nodes = restored.state.projects[0].nodes;
        assert.match(f.compile.compileConfirmationPair(nodes[1].metadata.productImagePrompt.prompt, nodes[0].metadata, 'load-view').pair.english, /8kg/);
        assert.deepEqual(f.compile.confirmationImageReferences(nodes[0].metadata, nodes[1].metadata.productImagePrompt, 'red').map(item => item.id), ['red-back']);
        assert.equal(f.compile.confirmationImageReferences(nodes[0].metadata, nodes[1].metadata.productImagePrompt, 'blue').length, 0);
    } finally { codec.close(); }
});

test('只更新关联提示词保留其他卡片、配置、ID、位置及结果；过程中改资料拒绝迟到响应', async () => {
    let response, interfere, submitted;
    const saves = [];
    const f = fixture({
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({ config: { model: 'synthetic-text' } }) } },
        '../产品/产品操作': { saveProductCanvas: async id => { saves.push(id); return { persisted: true }; } },
        '../产品/画布驻留保护': { productCanvasResidency: { acquire: () => () => {} } },
        '../画布生成/原画布文本调用': { confirmSavedCanvasText: async () => {}, requestCanvasText: async options => {
            submitted = options.messages;
            const task = { taskId: `task-${saves.length}`, slotId: options.scope.slotId };
            await options.recordTask(task);
            interfere?.();
            return options.applyAndSave(response, { taskId: task.taskId, responseHash: 'response' });
        } },
    });
    f.answer('load', '8', undefined, { scope: 'whole' });
    f.answer('evidence', '', undefined, { evidence: '承重图专属依据' });
    f.answer('brakes', 'unknown', 'red', { evidence: '不可加入承重图的刹车依据' });
    const plan = outputPlan(f);
    plan.images = plan.images.slice(0, 1);
    plan.confirmations = plan.confirmations.map(item => ({ ...item, imageKeys: item.imageKeys.filter(key => key === 'load-view') }));
    response = JSON.stringify(designProtocolPlan(plan));
    const beforeOther = structuredClone(f.prompts[1]), configs = structuredClone(f.configs);
    const { updateProductConfirmationImages } = f.loader.load('Excel画布/商品策划请求.ts');
    await updateProductConfirmationImages(f.ctx, 'product', 'load', new AbortController().signal);
    assert.match(JSON.stringify(submitted), /承重图专属依据/);
    assert.doesNotMatch(JSON.stringify(submitted), /不可加入承重图的刹车依据/);
    assert.deepEqual(f.prompts[1], beforeOther); assert.deepEqual(f.configs, configs);
    assert.equal(f.prompts[0].id, 'p-load');
    interfere = () => f.answer('load', '19', undefined, { scope: 'whole' });
    const old = f.prompts[0].metadata.productImagePrompt;
    await assert.rejects(updateProductConfirmationImages(f.ctx, 'product', 'load', new AbortController().signal), /更改|改变/);
    assert.equal(f.prompts[0].metadata.productImagePrompt, old);
    f.parameter.metadata.productImagePlan.confirmations[0].imageKeys = [];
    submitted = undefined;
    await assert.rejects(updateProductConfirmationImages(f.ctx, 'product', 'load', new AbortController().signal), /先选择/);
    assert.equal(submitted, undefined, '无关联卡片不得提交全套请求');
});

test('完整AI策划只附已关联事项的照片；拒绝把待确认照片放进无关卡片；正常应用不会被自身元数据误判为迟到', async () => {
    let response, submitted;
    const f = fixture({
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({ config: { model: 'synthetic-text' } }) } },
        '../产品/产品操作': { saveProductCanvas: async () => ({ persisted: true }) },
        '../产品/画布驻留保护': { productCanvasResidency: { acquire: () => () => {} } },
        './商品策划完成通知': { notifyProductPlanning() {} },
        '../画布生成/原画布文本调用': { confirmSavedCanvasText: async () => {}, requestCanvasText: async options => {
            submitted = options.messages;
            await options.recordTask({ taskId: 'full-plan', slotId: options.scope.slotId });
            return options.applyAndSave(response, { taskId: 'full-plan', responseHash: 'full-response' });
        } },
    });
    f.parameter.metadata.productPlatform = '未指定';
    f.answer('back', '', 'red', { images: [{ id: 'red-back', name: '背面', storageKey: 'file:red-back' }] });
    const plan = outputPlan(f), api = f.loader.load('Excel画布/商品策划请求.ts');
    plan.images[1].confirmationImageIds = ['red-back'];
    response = JSON.stringify(designProtocolPlan(plan));
    await assert.rejects(api.planProductImages(f.ctx, 'product', new AbortController().signal), /修正后仍未通过/);
    assert.match(JSON.stringify(submitted), /red-back/);
    plan.images[1].confirmationImageIds = [];
    plan.images[0].confirmationImageIds = ['red-back'];
    response = JSON.stringify(designProtocolPlan(plan));
    await api.planProductImages(f.ctx, 'product', new AbortController().signal);
    assert.equal(f.parameter.metadata.productImagePlan.imageCount, 2);
});
