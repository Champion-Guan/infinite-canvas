import assert from 'node:assert/strict';
import test from 'node:test';
import { variantModules } from './产品变体生成夹具.mjs';

const photograph = { chinese: '拍摄实际销售商品，保留结构、颜色和数量。', english: 'Photograph the actual sales product, preserving its structure, color, and quantity.' };
const design = { chinese: '以折页标题及语义图形展示本图信息。', english: 'Present this image information using a folded title and semantic graphics.' };
function data(keys = ['main', 'detail']) {
    return {
        protocolVersion: 'product-image-plan.v2',
        overview: { buyers: '买家', sellingPoints: '实际结构', concerns: '实际配置', consistency: '按本款参考', sequence: '按用户任务' },
        style: '真实摄影和趣味设计', assumptions: [], pendingFacts: [], confirmations: [],
        images: keys.map((key, index) => ({
            key, kind: index ? 'carousel' : 'main', name: index ? '结构细节' : '销售主图',
            buyerQuestion: '实际商品怎样', evidence: '实物参考', composition: '完整商品与局部观察',
            constraints: '保留商品事实', checks: '核对实际商品',
            delivery: { width: 1800, height: 2400, format: 'png', maxMB: 10 },
            prompt: { segments: [structuredClone(photograph)], designSegments: [structuredClone(design)], conditions: [] },
            variants: {},
        })),
    };
}
const load = () => variantModules();
const parse = (loader, value) => loader.load('Excel画布/商品提示词规则.ts').parseProductImagePlan(JSON.stringify(value), []);

test('中文、大写与下划线编号可规范化，并同步待确认关联，不改商品内容', () => {
    const loader = load(), input = data(['主图', 'Detail_CloseUp']);
    input.confirmations = [{
        id: 'proof', label: '结构实拍', question: '请提供结构实拍', kind: 'image', unit: '', scope: 'shared',
        scopes: [], imageKeys: ['Detail_CloseUp'], fallback: '仅展示已提供实拍可见部位',
    }];
    const before = structuredClone(input);
    const plan = parse(loader, input);
    assert.deepEqual(plan.images.map(image => image.key), ['image-1', 'detail-closeup']);
    assert.deepEqual(plan.confirmations[0].imageKeys, ['detail-closeup']);
    for (let index = 0; index < plan.images.length; index++) {
        assert.equal(plan.images[index].name, input.images[index].name);
        assert.equal(plan.images[index].prompt.english, photograph.english + '\n\n' + design.english);
    }
    assert.deepEqual(input, before, '不能修改调用方保存的模型原始返回');
    assert.deepEqual(parse(loader, input), plan, '相同响应重复解析得到相同编号');
});

test('无待确认引用的重复编号可确定性区分，保留原有合法编号且不丢图片', () => {
    const loader = load(), input = data(['main', 'main', 'main-2', 'Main']);
    const plan = parse(loader, input);
    const keys = plan.images.map(image => image.key);
    assert.equal(keys.length, 4);
    assert.equal(new Set(keys).size, 4);
    assert.equal(keys[0], 'main');
    assert.equal(keys[2], 'main-2', '不能占用后面图片已有的合法编号');
    assert.ok(keys.every(key => /^[a-z0-9][a-z0-9-]{0,79}$/.test(key)));
    assert.deepEqual(plan.images.map(image => image.name), input.images.map(image => image.name));
});

test('规范化不产生二次碰撞，长编号、空白与保留编号按同一规则稳定处理', () => {
    const loader = load(), input = data(['image-1', '主图', 'IMAGE_1', ' long name ', 'a'.repeat(100), 'long-name']);
    const parsed = parse(loader, input);
    const keys = parsed.images.map(image => image.key);
    assert.equal(keys[0], 'image-1');
    assert.equal(keys.at(-1), 'long-name');
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.every(key => /^[a-z0-9][a-z0-9-]{0,79}$/.test(key)));
    assert.deepEqual(parse(loader, parsed).images.map(image => image.key), keys);
});

test('重复编号存在待确认引用时拒绝猜关联，返回可恢复诊断且不泄漏原文', () => {
    const loader = load(), input = data(['detail', 'detail']);
    input.confirmations = [{
        id: 'proof', label: '实拍', question: '补充实拍', kind: 'image', unit: '', scope: 'shared',
        scopes: [], imageKeys: ['detail'], fallback: '保留实拍可见结构',
    }];
    assert.throws(() => parse(loader, input), error => {
        const issues = loader.load('Excel画布/商品策划协议恢复.ts').productPlanProtocolIssues(error);
        return error.code === 'invalid_product_plan_keys' && issues.some(issue => issue.problem === 'ambiguous_image_reference');
    });
    input.images[0].key = { private: 'sensitive-invalid-key' };
    assert.throws(() => parse(loader, input), error =>
        error.code === 'invalid_product_plan_keys' && !error.message.includes('sensitive')
        && !JSON.stringify(error.issues).includes('sensitive'));
});

test('编号修正只允许改变原本无效或重复的编号，名称、规格、顺序及合法编号继续受保护', () => {
    const loader = load(), recovery = loader.load('Excel画布/商品策划协议恢复.ts');
    const input = data(['main', 'detail', 'detail']);
    input.confirmations = [{
        id: 'proof', label: '实拍', question: '补充实拍', kind: 'image', unit: '', scope: 'shared',
        scopes: [], imageKeys: ['detail'], fallback: '保留实拍可见结构',
    }];
    const identity = recovery.productPlanImageIdentity(JSON.stringify(input));
    const corrected = structuredClone(input);
    corrected.images[1].key = 'detail-a';
    corrected.images[2].key = 'detail-b';
    corrected.confirmations[0].imageKeys = ['detail-b'];
    const parsed = parse(loader, corrected);
    assert.doesNotThrow(() => recovery.validateRepairedProductPlan(parsed, identity));
    for (const change of [
        plan => { plan.images[0].key = 'different-main'; },
        plan => { plan.images[1].name = '其他用途'; },
        plan => { plan.images[1].delivery.width = 2048; },
        plan => { plan.images.reverse(); },
        plan => { plan.images.pop(); },
    ]) {
        const changed = structuredClone(parsed); change(changed);
        assert.throws(() => recovery.validateRepairedProductPlan(changed, identity), { code: 'invalid_product_plan_protocol' });
    }
});

test('无效编号是对象时仍保留其他身份约束，不能借格式修正变更图片任务', () => {
    const loader = load(), recovery = loader.load('Excel画布/商品策划协议恢复.ts');
    const input = data([{ trim: 'untrusted-value' }, 'detail']);
    const identity = recovery.productPlanImageIdentity(JSON.stringify(input));
    assert.ok(identity);
    input.images[0].key = 'main';
    const corrected = parse(loader, input);
    assert.doesNotThrow(() => recovery.validateRepairedProductPlan(corrected, identity));
    corrected.images[0].name = '新任务';
    assert.throws(() => recovery.validateRepairedProductPlan(corrected, identity), { code: 'invalid_product_plan_protocol' });
});
