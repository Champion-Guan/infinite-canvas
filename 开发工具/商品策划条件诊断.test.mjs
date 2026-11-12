import assert from 'node:assert/strict';
import test from 'node:test';
import { variantModules } from './产品变体生成夹具.mjs';

const loader = variantModules();
const rules = loader.load('Excel画布/商品待确认规则.ts');
const compile = loader.load('Excel画布/商品待确认提示词.ts');
const field = (id, kind, imageKey = 'detail') => ({
    id, kind, label: '待确认参数', question: '请提供真实商品依据。', unit: kind === 'number' ? 'kg' : '',
    scope: 'shared', scopes: [], imageKeys: [imageKey], fallback: '未确认时只展示已知结构。',
});
const unknown = { chinese: '只展示实拍可见结构，不添加未经确认的宣传。',
    english: 'Show only the visible structure in the reference photograph. Add no unconfirmed claims.' };
const number = { factId: 'load', unknown, known: { chinese: '标注实测值{{value}}{{unit}}。',
    english: 'Label the measured value as {{value}}{{unit}}.' } };
const choice = { factId: 'brakes', unknown,
    yes: { chinese: '展示已确认带刹车的实拍脚轮。', english: 'Show the confirmed caster with brakes from the reference photograph.' },
    no: { chinese: '展示无刹车脚轮，不补造拨片。', english: 'Show the caster without brakes and do not invent a lever.' } };
function inspect(operation) {
    let caught;
    assert.throws(operation, error => {
        caught = error;
        return error instanceof rules.ProductConfirmationProtocolError
            && error.code === 'invalid_confirmation_protocol' && /原方案已保留/.test(error.message);
    });
    return caught.issues;
}
const validate = (templates, fields, chinese = '实物摄影。{{fact:load}}', english = 'Photograph the actual product. {{fact:load}}') =>
    rules.validateConditionalTemplates(chinese, english, JSON.stringify(templates), fields, 'detail', 'images[0].prompt');

test('真实失败形态同时指出choice错误known、递归变量和正文缺绑定，不猜测yes或no', () => {
    const malformed = { factId: 'brakes', unknown, known: {
        chinese: '根据{{fact:brakes}}确认结果展示拨片。',
        english: 'Show the lever based on the confirmed result {{fact:brakes}}.',
    } };
    const issues = inspect(() => validate([malformed], [field('brakes', 'choice')],
        '保持当前确认字段的yes分支。', 'Use the current yes branch for the confirmation field.'));
    for (const problem of ['missing_fact_token', 'missing_choice_branch', 'wrong_branch', 'recursive_fact'])
        assert.ok(issues.some(issue => issue.problem === problem), problem);
    assert.ok(issues.some(issue => issue.path === 'images[0].prompt.conditions[0].no'));
    assert.ok(issues.every(issue => issue.factId === 'brakes'));
    assert.equal(malformed.yes, undefined);
    assert.equal(malformed.no, undefined);
});

test('缺少数值绑定以及照片或文字依据被错误包装为可自动采用的条件均继续拒绝', () => {
    const missing = inspect(() => validate([number], [field('load', 'number')],
        '不展示承重或加厚宣传。', 'Do not show load-bearing or thick-material claims.'));
    assert.deepEqual(missing.map(issue => issue.problem), ['missing_fact_token', 'missing_fact_token']);
    for (const kind of ['image', 'supplement']) {
        const invalid = { factId: 'proof', unknown, known: {
            chinese: '根据非空补充内容增加销售配件。', english: 'Add included accessories based on the non-empty supplement.',
        } };
        const issues = inspect(() => validate([invalid], [field('proof', kind)],
            '实物摄影。{{fact:proof}}', 'Photograph the actual product. {{fact:proof}}'));
        assert.ok(issues.some(issue => issue.problem === 'evidence_requires_review' && issue.factId === 'proof'));
    }
});

test('分支格式诊断只保留固定路径和原因，不把模型长响应带入错误', () => {
    const source = 'private candidate '.repeat(1000);
    const issues = inspect(() => rules.parseConditionalTemplates([{ factId: 'load',
        unknown: { chinese: source, english: unknown.english } }], 'images[2].prompt.conditions'));
    assert.deepEqual(issues, [{ path: 'images[2].prompt.conditions[0].unknown.chinese', problem: 'invalid_text' }]);
    assert.doesNotMatch(JSON.stringify(issues), /private candidate/);
    const safe = new rules.ProductConfirmationProtocolError([
        { path: '/Users/private/candidate', problem: 'invalid_condition', factId: source },
    ]);
    assert.deepEqual(safe.issues, [{ path: 'confirmations', problem: 'invalid_condition' }]);
    assert.ok(inspect(() => rules.parseConfirmations([{ ...field('load', 'number'), imageKeys: ['removed'] }], ['detail']))
        .some(issue => issue.path === 'confirmations[0]'));
});

test('错误分支、未知分支变量及非法正文变量不能被静默忽略', () => {
    const examples = [
        { template: { ...number, yes: choice.yes }, fields: [field('load', 'number')], expected: 'wrong_branch' },
        { template: { ...number, unknown: { ...unknown, english: 'Show {{value}} kg even when unknown.' } },
            fields: [field('load', 'number')], expected: 'placeholder_in_fallback' },
        { template: { ...choice, yes: { ...choice.yes, chinese: '展示{{value}}。' } },
            fields: [field('brakes', 'choice')], expected: 'placeholder_in_choice', token: 'brakes' },
        { template: number, fields: [field('load', 'number', 'other-image')], expected: 'wrong_image' },
    ];
    for (const item of examples) {
        const token = item.token || 'load';
        assert.ok(inspect(() => validate([item.template], item.fields,
            `实物摄影。{{fact:${token}}}`, `Photograph the actual product. {{fact:${token}}}`))
            .some(issue => issue.problem === item.expected), item.expected);
    }
    assert.ok(inspect(() => validate([], [], '实物摄影{{value}}。', 'Photograph the actual product.'))
        .some(issue => issue.problem === 'unknown_placeholder'));
});

test('有效number和choice模板原样通过，编译始终按已确认答案或保守分支执行', () => {
    for (const [template, confirmation] of [[number, field('load', 'number')], [choice, field('brakes', 'choice')]]) {
        const chinese = `实物摄影。{{fact:${confirmation.id}}}`, english = `Photograph the actual product. {{fact:${confirmation.id}}}`;
        const serialized = rules.parseConditionalTemplates([template], 'images[0].prompt.conditions');
        assert.doesNotThrow(() => rules.validateConditionalTemplates(chinese, english, serialized, [confirmation], 'detail'));
        const metadata = { productImagePlan: { pendingFacts: [], confirmations: [confirmation] } };
        const pair = { chinese, english, translatedChinese: chinese, conditionalTemplate: serialized };
        const fallback = compile.compileConfirmationPair(pair, metadata, 'detail').pair;
        assert.match(fallback.english, /Add no unconfirmed claims/);
        assert.doesNotMatch(fallback.english, /\{\{/);
        const patch = rules.confirmationAnswerPatch(metadata, confirmation, undefined,
            { value: confirmation.kind === 'number' ? '8' : 'no' });
        const confirmed = compile.compileConfirmationPair(pair, { ...metadata, ...patch }, 'detail').pair;
        assert.match(confirmed.english, confirmation.kind === 'number' ? /8kg/ : /without brakes/);
        assert.doesNotMatch(confirmed.english, /\{\{/);
    }
});

test('同一条件在每语言只能绑定一次，中英缺绑定或多绑定均拒绝', () => {
    const token = '{{fact:load}}';
    for (const [chinese, english, language] of [
        [`实物${token}${token}。`, `Photograph the product. ${token}`, 'chinese'],
        [`实物${token}。`, `Photograph the product. ${token} ${token}`, 'english'],
    ]) {
        const issues = inspect(() => validate([number], [field('load', 'number')], chinese, english));
        assert.ok(issues.some(issue => issue.problem === 'duplicate_fact_token' && issue.path === `images[0].prompt.${language}`));
    }
    assert.ok(inspect(() => validate([number], [field('load', 'number')],
        `实物${token}。`, 'Photograph the product.')).some(issue => issue.problem === 'missing_fact_token' && issue.path.endsWith('.english')));
});
