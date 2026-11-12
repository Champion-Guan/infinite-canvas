import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const body = [{ chinese: '拍摄一件真实白色三层置物架，保持实物比例。', english: 'Photograph one actual white three-tier rack, preserving its real proportions.' }];
const design = [
    { chinese: '左上深棕不规则大标题底板显示“Этажерка”。', english: 'Use a large irregular dark-brown title board at upper left reading “Этажерка”. ' },
    { chinese: '副标题条配手绘浴缸图标，标题外侧添加放射短线和小箭头。', english: 'Add a hand-drawn bathtub icon to the subtitle strip, with radiating strokes and a small arrow outside the heading.' },
];
const prompt = (designSegments = design) => ({ segments: structuredClone(body), designSegments: structuredClone(designSegments), conditions: [] });
function data() {
    return {
        protocolVersion: 'product-image-plan.v2',
        overview: { buyers: '家庭用户', sellingPoints: '真实结构', concerns: '实际外观', consistency: '按实物', sequence: '先整体' },
        style: '真实浴室摄影与趣味平面设计', assumptions: [], pendingFacts: [], confirmations: [],
        images: [{
            key: 'main', kind: 'main', name: '销售主视觉', buyerQuestion: '商品是什么', evidence: '实物照片',
            composition: '完整三层商品', constraints: '不改变商品结构', checks: '检查结构与文字',
            delivery: { width: 1800, height: 2400, format: 'png', maxMB: 10 },
            prompt: prompt(), variants: {},
        }],
    };
}
const parse = (loader, input, variants = [], options = {}) =>
    loader.load('Excel画布/商品提示词规则.ts').parseProductImagePlan(JSON.stringify(input), variants, options);

test('新策划只从双语设计段派生说明与完整正文，真实遗漏的图标及手绘全部进入英文', () => {
    const loader = variantModules(), input = data(), source = structuredClone(input);
    input.images[0].copyLayout = '旧的独立说明不得覆盖设计段';
    const image = parse(loader, input, [], { requireDesign: true }).images[0];
    assert.equal(image.copyLayout, design.map(item => item.chinese).join(''));
    assert.equal(image.prompt.chinese, body[0].chinese + '\n\n' + image.copyLayout);
    assert.equal(image.prompt.english, body[0].english + '\n\n' + design.map(item => item.english).join(''));
    assert.match(image.prompt.english, /hand-drawn bathtub icon.*radiating strokes.*small arrow/);
    assert.doesNotMatch(image.prompt.english, /[\u3400-\u9fff]/);
    assert.equal(image.prompt.translatedChinese, image.prompt.chinese);
    const last = image.prompt.alignment.at(-1);
    assert.equal(image.prompt.chinese.slice(last[0], last[1]), design[1].chinese);
    assert.equal(image.prompt.english.slice(last[2], last[3]), design[1].english);
    delete input.images[0].copyLayout;
    assert.deepEqual(input, source, '解析不能改写模型原始数据');
    assert.deepEqual(parse(loader, input).images[0], image, '版本2默认也编译设计段，不依赖入口选项');
    assert.equal(Object.hasOwn(image.prompt, 'designSegments'), false, '落卡后只保存完整正文，不在生图时再次附加');
});

test('旧全文提示词及字符串排版说明保持兼容，新请求缺失协议或设计返回安全可修复错误', () => {
    const loader = variantModules(), legacy = data();
    delete legacy.protocolVersion;
    legacy.images[0].prompt = { chinese: body[0].chinese, english: body[0].english };
    legacy.images[0].copyLayout = '旧版排版说明';
    const old = parse(loader, legacy).images[0];
    assert.equal(old.prompt.english, body[0].english);
    assert.equal(old.copyLayout, '旧版排版说明');
    assert.throws(() => parse(loader, legacy, [], { requireDesign: true }), {
        code: 'invalid_product_plan_design', path: 'protocolVersion', reason: 'protocol_required',
    });
    for (const [change, path, reason] of [
        [value => delete value.images[0].prompt.designSegments, 'images[0].prompt.designSegments', 'design_segments_required'],
        [value => value.images[0].prompt.designSegments = [], 'images[0].prompt.designSegments', 'design_segments_invalid'],
        [value => value.images[0].prompt.designSegments[0].english = '', 'images[0].prompt.designSegments', 'design_segments_invalid'],
        [value => delete value.images[0].prompt.segments, 'images[0].prompt.segments', 'body_segments_required'],
        [value => value.images[0].prompt.segments = [], 'images[0].prompt.segments', 'body_segments_invalid'],
    ]) {
        const input = data(); change(input);
        assert.throws(() => parse(loader, input), { code: 'invalid_product_plan_design', path, reason });
    }
    const unknown = data(); unknown.protocolVersion = 'untrusted-secret-value';
    assert.throws(() => parse(loader, unknown), error => error.code === 'invalid_product_plan_design'
        && error.path === 'protocolVersion' && error.reason === 'protocol_unsupported' && !error.message.includes('untrusted'));
    const variant = data(), privateId = 'variant-private-value';
    variant.images[0].variants[privateId] = prompt(); delete variant.images[0].variants[privateId].designSegments;
    assert.throws(() => parse(loader, variant, [privateId]), error => error.path === 'images[0].variants[0].designSegments'
        && !JSON.stringify({ message: error.message, path: error.path }).includes(privateId));
});

test('变体各自编译设计文案与真实尺寸，不共享主方案或其他变体的设计段', () => {
    const loader = variantModules(), input = data();
    input.images[0].variants.red = prompt([{ chinese: '红色款标签“10 cm”。', english: 'Use the red variant label “10 cm”.' }]);
    input.images[0].variants.blue = prompt([{ chinese: '蓝色款标签“20 cm”。', english: 'Use the blue variant label “20 cm”.' }]);
    const image = parse(loader, input, ['red', 'blue']).images[0];
    assert.match(image.variants.red.english, /red variant label “10 cm”/);
    assert.doesNotMatch(image.variants.red.english, /20 cm|bathtub|Этажерка/);
    assert.match(image.variants.blue.english, /blue variant label “20 cm”/);
    assert.doesNotMatch(image.variants.blue.english, /10 cm|bathtub|Этажерка/);
});

test('版本2流式预览拼接主体与设计双语片段，逐字返回和变体切片都能显示趣味设计', () => {
    const loader = variantModules({ 'partial-json': require('partial-json') });
    const preview = loader.load('Excel画布/商品策划预览规则.ts').readProductPlanningPreview;
    const input = data();
    input.images[0].variants.red = prompt([{ chinese: '红款小箭头与“10 cm”标签。', english: 'A small red-variant arrow and a “10 cm” label.' }]);
    input.images[0].variants.blue = prompt([{ chinese: '蓝款手绘线与“20 cm”标签。', english: 'Blue-variant hand-drawn strokes and a “20 cm” label.' }]);
    const wire = JSON.stringify(input);
    for (let end = 0; end <= wire.length; end++) assert.doesNotThrow(() => preview(wire.slice(0, end)));
    const complete = preview(wire).images[0], compiled = parse(loader, input, ['red', 'blue']).images[0];
    assert.equal(complete.prompt.chinese, compiled.prompt.chinese);
    assert.equal(complete.prompt.english, compiled.prompt.english);
    assert.match(complete.prompt.english, /bathtub icon.*radiating strokes.*small arrow/);
    assert.equal(complete.fields.some(field => field.label === '图片文字与排版'), false, 'v2不依赖旧copyLayout才能展示设计');
    for (const variant of complete.variants) {
        assert.equal(variant.prompt.chinese, compiled.variants[variant.id].chinese);
        assert.equal(variant.prompt.english, compiled.variants[variant.id].english);
    }
    const mainCut = wire.indexOf('副标题条配手绘浴缸图标') + '副标题条配手绘浴缸'.length;
    assert.equal(preview(wire.slice(0, mainCut)).images[0].prompt.chinese,
        body[0].chinese + '\n\n' + design[0].chinese + '副标题条配手绘浴缸');
    const variantCut = wire.indexOf('蓝款手绘线') + '蓝款手绘'.length;
    const partialVariant = preview(wire.slice(0, variantCut)).images[0].variants.find(item => item.id === 'blue');
    assert.equal(partialVariant.prompt.chinese, body[0].chinese + '\n\n蓝款手绘');
    assert.doesNotMatch(partialVariant.prompt.chinese, /红款|10 cm|浴缸/);
});

test('设计中的动态事实只编译一次，未知与已确认分支均保留绑定及图标设计', () => {
    const loader = variantModules(), input = data();
    input.confirmations = [{ id: 'load', label: '整架承重', question: '实测承重是多少', kind: 'number', unit: 'kg',
        scope: 'shared', scopes: [], imageKeys: ['main'], fallback: '未确认不展示承重' }];
    input.images[0].prompt.designSegments.push({ chinese: '角标：{{fact:load}}。', english: 'Corner badge: {{fact:load}}.' });
    input.images[0].prompt.conditions = [{ factId: 'load',
        unknown: { chinese: '不展示承重数字或性能承诺', english: 'Do not show load figures or performance claims' },
        known: { chinese: '展示整架实测承重{{value}}{{unit}}', english: 'Show the verified whole-rack load of {{value}}{{unit}}' } }];
    const parsed = parse(loader, input), pair = parsed.images[0].prompt;
    const rules = loader.load('Excel画布/商品待确认规则.ts'), compile = loader.load('Excel画布/商品待确认提示词.ts').compileConfirmationPair;
    assert.equal(rules.factTokens(pair.chinese).length, 1);
    assert.equal(rules.factTokens(pair.english).length, 1);
    let metadata = { productImagePlan: { confirmations: parsed.confirmations, pendingFacts: [] } };
    const unknown = compile(pair, metadata, 'main').pair;
    assert.match(unknown.english, /Do not show load figures/);
    assert.doesNotMatch(unknown.english, /\{\{|12kg/);
    metadata = { ...metadata, ...rules.confirmationAnswerPatch(metadata, parsed.confirmations[0], undefined, { value: '12' }) };
    const known = compile(pair, metadata, 'main').pair;
    assert.match(known.english, /verified whole-rack load of 12kg/);
    assert.equal(known.english.match(/12kg/g).length, 1);
    assert.match(known.english, /bathtub icon/);
    assert.doesNotMatch(known.english, /\{\{/);
});

test('落卡正文与真实生图上下文一致，多次执行和用户手改不会重新追加旧设计', () => {
    const jsx = (type, props) => ({ type, props: props || {} });
    const loader = variantModules({
        '@/lib/canvas/node-registry': { getNodeDefinition: type => type === 'guan:product-prompt' ? { resource: () => ({ kind: 'text', text: '' }) } : undefined },
        react: { useEffect() {}, useRef: value => ({ current: value }), useState: value => [typeof value === 'function' ? value() : value, () => {}] },
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { Languages: 'Languages', RotateCcw: 'RotateCcw' },
        antd: { Segmented: 'Segmented' }, './Excel画布上下文': { useExcelProductId: () => 'product' },
        './商品策划请求': { translateProductPrompt() {} }, './商品待确认编辑': { ProductConfirmationDialog: 'dialog' },
        './图片引用标签': { ImageReferenceText: 'reference-text', ImageReferenceToken: 'reference-token' },
        '../主题/页签内容过渡': { TabContentTransition: 'transition' },
        '../提示词/双语联动文本框': { useBilingualPromptSync: () => ({}), BilingualPromptField: 'prompt-field' },
    });
    const fixture = variantFixture(), parameter = fixture.parameter;
    delete parameter.metadata.productVariants;
    const rules = loader.load('Excel画布/商品提示词规则.ts'), image = parse(loader, data()).images[0];
    const node = { id: 'planned-main', title: '主图', type: 'guan:product-prompt', position: { x: 500, y: 0 }, width: 440, height: 540,
        metadata: { productImagePrompt: { ...image, parameterId: parameter.id, generatedSignature: '' },
            productPromptSourceFingerprint: rules.planningFingerprint(parameter.metadata) } };
    const config = { ...fixture.config, metadata: { generationMode: 'image', productPromptConfigKey: node.id } };
    const nodes = [parameter, node, config], connections = [
        { id: 'a', fromNodeId: parameter.id, toNodeId: node.id }, { id: 'b', fromNodeId: node.id, toNodeId: config.id },
    ];
    const ctx = { node, getNode: id => nodes.find(value => value.id === id), getConnections: () => connections,
        theme: { node: {} }, updateMetadata: patch => { node.metadata = { ...node.metadata, ...patch }; } };
    const fields = element => !element || typeof element !== 'object' ? [] :
        [element, ...[element.props?.children].flat(Infinity).flatMap(fields)];
    const component = loader.load('Excel画布/商品提示词卡片.tsx').ProductPromptContent;
    const generate = () => loader.load('画布生成/商品提示词生成.ts').buildProductGenerationContext(config.id, nodes, connections, '');
    const first = generate(), second = generate();
    const displayed = fields(component({ ctx })).find(element => element.props?.['aria-label'] === '英文生图提示词').props.value;
    assert.equal(displayed, image.prompt.english);
    assert.ok(first.prompt.includes(displayed));
    assert.equal(first.prompt, second.prompt);
    assert.equal(first.prompt.match(/hand-drawn bathtub icon/g).length, 1);
    assert.doesNotMatch(first.prompt, /副标题条配手绘浴缸/);
    const edited = { chinese: '拍摄完整真实商品，不添加任何文字或图标。',
        english: 'Photograph the complete actual product, without adding any text, icons or decorative marks.' };
    node.metadata.productImagePrompt.prompt = { ...edited, translatedChinese: edited.chinese };
    const after = generate();
    assert.ok(after.prompt.includes(edited.english));
    assert.doesNotMatch(after.prompt, /bathtub icon|radiating strokes|Этажерка/);
    assert.equal(fields(component({ ctx })).find(element => element.props?.['aria-label'] === '英文生图提示词').props.value, edited.english);
});
