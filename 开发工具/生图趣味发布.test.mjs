import assert from 'node:assert/strict';
import test from 'node:test';
import { variantModules } from './产品变体生成夹具.mjs';

const body = [{ chinese: '拍摄参考中的真实商品，保留外观和比例。', english: 'Photograph the actual referenced product, preserving its appearance and proportions. ' }];
const design = [
    { chinese: '折页标题显示“Праздник”，配票券信息条。', english: 'Use a folded heading reading “Праздник” with a ticket information strip. ' },
    { chinese: '用星芒和松枝手绘呼应标题，保持商品清楚。', english: 'Echo the heading with starbursts and hand-drawn fir sprigs, keeping the product clear.' },
];
function plan() {
    return {
        protocolVersion: 'product-image-plan.v2',
        overview: { buyers: '节庆买家', sellingPoints: '实际图案', concerns: '款式一致', consistency: '使用本款参考', sequence: '保持用户任务' },
        style: '真实摄影与丰富趣味设计', assumptions: [], pendingFacts: [], confirmations: [],
        images: [{
            key: 'main', kind: 'main', name: '节日主视觉', buyerQuestion: '实际商品是什么', evidence: '本款实拍',
            composition: '完整商品与节庆场景', constraints: '保留真实结构', checks: '检查图案、文字与设计',
            delivery: { width: 1800, height: 2400, format: 'png', maxMB: 10 },
            prompt: { segments: structuredClone(body), designSegments: structuredClone(design), conditions: [] }, variants: {},
        }],
    };
}
const parse = (input, variants = []) => variantModules().load('Excel画布/商品提示词规则.ts')
    .parseProductImagePlan(JSON.stringify(input), variants);

test('发布默认角色保留丰富趣味、跨品类适配与用户任务，输出协议完整传递设计', () => {
    const { PRODUCT_PLANNING_ROLE: role, PRODUCT_PLANNING_OUTPUT: output } = variantModules().load('Excel画布/商品视觉策划指令.ts');
    assert.match(role, /丰富趣味是默认交付要求/);
    assert.match(role, /不得为了减少内容重复而擅自改换用户任务/);
    assert.match(role, /每次重新判断品类，不继承上一商品模板/);
    assert.match(role, /主视觉必须同时落实这四个方面，其他设计图至少组合其中三类/);
    assert.match(role, /单纯加粗、放大、换颜色和改为左对齐不算完成标题设计/);
    assert.match(output, /默认主视觉四方面的趣味组合、其他设计图至少三类组合必须进入实际正文/);
    assert.match(output, /protocolVersion="product-image-plan.v2"/);
});

test('模型实际设计片段只编译一次，排版说明与英文正文同源且不丢图标手绘', () => {
    const input = plan();
    input.images[0].copyLayout = '旧说明不能覆盖已选设计';
    const image = parse(input).images[0];
    assert.equal(image.copyLayout, design.map(segment => segment.chinese).join(''));
    assert.equal(image.prompt.chinese, body[0].chinese + '\n\n' + image.copyLayout);
    assert.equal(image.prompt.english, body[0].english.trimEnd() + '\n\n' + design.map(segment => segment.english).join(''));
    assert.match(image.prompt.english, /ticket information strip.*starbursts.*fir sprigs/);
    assert.equal(image.prompt.english.match(/starbursts/g).length, 1);
    const last = image.prompt.alignment.at(-1);
    assert.equal(image.prompt.english.slice(last[2], last[3]), design[1].english);
    assert.equal(image.prompt.translatedChinese, image.prompt.chinese);
});

test('旧卡片全文仍可解析，缺少新版设计片段明确失败并保留旧内容', () => {
    const input = plan(), pair = input.images[0].prompt;
    delete input.protocolVersion;
    input.images[0].prompt = { chinese: body[0].chinese, english: body[0].english };
    input.images[0].copyLayout = '旧卡片排版';
    assert.equal(parse(input).images[0].prompt.english, body[0].english.trim());
    input.protocolVersion = 'product-image-plan.v2';
    input.images[0].prompt = { segments: pair.segments };
    assert.throws(() => parse(input), { code: 'invalid_product_plan_design', reason: 'design_segments_required' });
});

test('每个变体独立编译实际文案与商品尺寸，不混入其他款设计', () => {
    const input = plan();
    for (const [id, dimension] of [['tree', '50*60cm'], ['snowflake', '40*55cm']]) {
        input.images[0].variants[id] = {
            segments: structuredClone(body),
            designSegments: [{ chinese: `本款标签“${dimension}”。`, english: `Use this variant label “${dimension}”.` }],
            conditions: [],
        };
    }
    const image = parse(input, ['tree', 'snowflake']).images[0];
    assert.match(image.variants.tree.english, /50\*60cm/);
    assert.doesNotMatch(image.variants.tree.english, /40\*55cm|starbursts/);
    assert.match(image.variants.snowflake.english, /40\*55cm/);
    assert.doesNotMatch(image.variants.snowflake.english, /50\*60cm|Праздник/);
});

test('设计中的动态事实保留单次绑定，未知与填写分支都不丢趣味指令', () => {
    const input = plan();
    input.confirmations = [{
        id: 'height', label: '高度', question: '实测高度是多少', kind: 'number', unit: 'cm', scope: 'shared',
        scopes: [], imageKeys: ['main'], fallback: '不显示尺寸',
    }];
    input.images[0].prompt.designSegments.push({ chinese: '尺寸：{{fact:height}}。', english: 'Dimension: {{fact:height}}.' });
    input.images[0].prompt.conditions = [{
        factId: 'height',
        unknown: { chinese: '不显示尺寸', english: 'Show no dimension' },
        known: { chinese: '显示高度{{value}}{{unit}}', english: 'Show height {{value}}{{unit}}' },
    }];
    const image = parse(input).images[0], loader = variantModules();
    const facts = loader.load('Excel画布/商品待确认规则.ts');
    const compile = loader.load('Excel画布/商品待确认提示词.ts').compileConfirmationPair;
    assert.equal(facts.factTokens(image.prompt.english).length, 1);
    let metadata = { productImagePlan: { confirmations: input.confirmations, pendingFacts: [] } };
    assert.match(compile(image.prompt, metadata, 'main').pair.english, /Show no dimension/);
    metadata = { ...metadata, ...facts.confirmationAnswerPatch(metadata, input.confirmations[0], undefined, { value: '60' }) };
    const result = compile(image.prompt, metadata, 'main').pair.english;
    assert.match(result, /Show height 60cm/);
    assert.match(result, /starbursts/);
    assert.doesNotMatch(result, /\{\{/);
});
