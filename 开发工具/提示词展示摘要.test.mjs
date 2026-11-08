import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { promptHighlightSegments } from '../扩展功能/画布迁移扩展/prompt-variable-highlight.js';

const source = '扩展功能/提示词/提示词展示摘要.js';
const { code } = await transformWithEsbuild(readFileSync(source, 'utf8'), source, { loader: 'js', format: 'cjs', target: 'es2022' });
const module = { exports: {} };
new Function('module', 'exports', code)(module, module.exports);
const { promptDisplaySegments, promptDisplaySummary } = module.exports;

test('从提示词摘要提取明确总结、主题角度、像素、比例与变量', () => {
    const prompt = '总结：展示可调节支架的侧视角。\n主题/角度：侧面 45 度\nOutput size: 1152 x 1536 px\nAspect ratio: 3:4\n产品：[PRODUCT NAME]';
    const summary = promptDisplaySummary(prompt, { excelPromptTokens: ['[PRODUCT NAME]'] });
    assert.equal(summary.summary, '展示可调节支架的侧视角');
    assert.equal(summary.theme, '侧面 45 度');
    assert.equal(summary.pixels, '1152 x 1536 px');
    assert.equal(summary.ratio, '3:4');
    assert.deepEqual(summary.variables, ['[PRODUCT NAME]']);
});

test('支持常见输出格式，也不把产品尺寸当成图片像素', () => {
    const prompt = '画面呈现产品尺寸 73 x 46 cm。\n生成分辨率：1584×992\n比例：8:5';
    const summary = promptDisplaySummary(prompt);
    assert.equal(summary.pixels, '1584×992');
    assert.equal(summary.ratio, '8:5');
});

test('摘要字段只来自现有元数据或提示词明确值，不推断像素与比例', () => {
    const summary = promptDisplaySummary('主题：桌面使用场景\n[NAME]', { excelPromptPurpose: '展示真实桌面场景' });
    assert.equal(summary.summary, '展示真实桌面场景');
    assert.equal(summary.theme, '桌面使用场景');
    assert.equal(summary.pixels, '');
    assert.equal(summary.ratio, '');
    assert.deepEqual(summary.variables, ['[NAME]']);
});

test('只有主题时不重复伪装成总结，并将COMPOSITION LOCK作为主题/角度高亮', () => {
    const prompt = 'COMPOSITION LOCK: full product hero.\nCreate one 900 x 1200 px image.';
    const summary = promptDisplaySummary(prompt, { excelPromptTheme: '完整产品主图' });
    assert.equal(summary.summary, '');
    const parts = promptDisplaySegments([{ text: prompt }], summary);
    assert.ok(parts.some(part => part.kind === 'theme' && part.text === 'COMPOSITION LOCK: full product hero'));
});

test('变量、主题、像素和比例分别标注，高亮片段拼接后与正文完全一致', () => {
    const prompt = 'Theme: side angle\nUse [PRODUCT NAME], render 900 x 1200 px at 3:4.';
    const summary = promptDisplaySummary(prompt, { excelPromptTheme: 'side angle' });
    const parts = promptDisplaySegments([
        { text: 'Theme: side angle\nUse ' },
        { text: 'lamp', token: '[PRODUCT NAME]' },
        { text: ', render 900 x 1200 px at 3:4.' },
    ], summary);
    assert.equal(parts.map(part => part.text).join(''), prompt.replace('[PRODUCT NAME]', 'lamp'));
    assert.ok(parts.some(part => part.kind === 'theme' && part.text.includes('side angle')));
    assert.ok(parts.some(part => part.kind === 'variable' && part.token === '[PRODUCT NAME]'));
    assert.ok(parts.some(part => part.kind === 'pixels' && part.text.includes('900 x 1200 px')));
    assert.ok(parts.some(part => part.kind === 'ratio' && part.text === '3:4'));
});

test('不把任意数字比例当图片比例，也能从正文变量中得到完整列表', () => {
    const summary = promptDisplaySummary('主体为 12:7 金属螺丝，使用 [A] 和 [B]。');
    assert.equal(summary.ratio, '');
    assert.deepEqual(summary.variables, ['[A]', '[B]']);
});

test('最终提示词带自动约束和产品补充时仍保留变量来源高亮', () => {
    const raw = 'Show [PRODUCT NAME] at 900 x 1200 px.';
    const content = 'Show sewing kit at 900 x 1200 px.\n\n【变量与画面约束】\n不要猜测数据。\n\n【产品补充】\n突出收纳方式。';
    const segments = promptHighlightSegments(content, raw, { '[PRODUCT NAME]': 'sewing kit' });
    assert.ok(segments.some(part => part.token === '[PRODUCT NAME]' && part.text === 'sewing kit'));
    assert.equal(segments.map(part => part.text).join(''), content);
});

test('手工改写模板正文时不按相同变量值猜测高亮来源', () => {
    const segments = promptHighlightSegments('Rewritten sewing kit prompt.', 'Show [PRODUCT NAME].', { '[PRODUCT NAME]': 'sewing kit' });
    assert.ok(!segments.some(part => part.token));
});
