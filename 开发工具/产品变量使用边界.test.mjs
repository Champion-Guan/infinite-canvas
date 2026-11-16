import assert from 'node:assert/strict';
import { platformState } from './全局平台规则夹具.mjs';
import { test } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { variantModules } from './产品变体生成夹具.mjs';
import * as delivery from '../扩展功能/媒体交付/生成图片尺寸交付.mjs';

async function load(file, dependencies = {}) {
    dependencies = { './平台规则全局状态': platformState, ...dependencies };
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: file.endsWith('.js') ? 'js' : 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const variables = await load('扩展功能/提示词/变量使用规则.ts');
const { resolvePromptVariables: resolvePrompt } = variables;
const themes = await load('扩展功能/Excel画布/旧版主题翻译.js');
const rules = await load('扩展功能/Excel画布/旧版参数规则.ts', { './旧版主题翻译.js': themes, '../提示词/变量使用规则': variables,
    './商品待确认规则': variantModules().load('Excel画布/商品待确认规则.ts') });
const protectedText = await load('扩展功能/提示词/生成文本读取.ts', { './变量使用规则': variables, '../Excel画布/旧版参数规则': rules,
    './提示词优化规则': variantModules().load('提示词/提示词优化规则.ts'),
    '../Excel画布/商品提示词规则': variantModules().load('Excel画布/商品提示词规则.ts') });
const contexts = await load('扩展功能/Excel画布/Excel卡片上下文.ts', { './旧版参数规则': rules });
const titles = await load('扩展功能/Excel画布/旧版最终提示词标题.ts');
const parameterLinks = await load('扩展功能/Excel画布/产品参数联动.ts', { '../提示词/变量使用规则': variables, './旧版最终提示词标题': titles, './旧版参数规则': rules });
const transactions = await load('扩展功能/Excel画布/Excel卡片事务.ts', { './旧版参数规则': rules, './产品参数联动': parameterLinks, './旧版最终提示词标题': titles, './Excel卡片上下文': contexts });
const sync = await load('扩展功能/Excel画布/旧版提示词同步.ts', { './旧版参数规则': rules });
const beforeRules = text => { assert.doesNotMatch(text, /【变量与画面约束】/); return text; };
const box = (id, metadata = {}, type = 'text') => ({ id, title: id, type, position: { x: 0, y: 0 }, width: 340, height: 240, metadata });
const parameter = values => box('parameter', { promptVariableValues: values }, 'guan:prompt-variables');

test('普通手动提示词与尺寸要求保持原文，不再自动追加任何变量或画面约束', () => {
    for (const prompt of ['更改一下图片的尺寸', '把尺寸改为3.2 cm和6 cm', 'Theme: dimensions display', '普通文字', '', '@[node:abc] [1] [0-5秒] [PRODUCT PHOTO/CAD]'])
        assert.equal(resolvePrompt(prompt), prompt);
});
test('旧模板只替换已填写值，不推断主题或抑制已填写尺寸，未填写内容保持原文', () => {
    for (const theme of ['lifestyle scene', '材质结构', 'dimensions display']) {
        const prompt = `Theme: ${theme}\n[LENGTH] [COUNT] [MATERIAL]\nOutput: 1152 x 1536 px 3:4`;
        assert.equal(resolvePrompt(prompt, { '[length]': '73.6 cm', '[COUNT]': '0' }),
            `Theme: ${theme}\n73.6 cm 0 [MATERIAL]\nOutput: 1152 x 1536 px 3:4`);
    }
});
test('显式清空不退回旧别名，待填写等占位值不生成默认值或约束文字', () => {
    const prompt = '[LENGTH] [COUNT] [MATERIAL]';
    assert.equal(resolvePrompt(prompt, { '[LENGTH]': '', '[length]': '88 cm', '[COUNT]': '待填写', '[MATERIAL]': '[MATERIAL]' }), prompt);
});
const legacyRules = '【变量与画面约束】\n仅使用用户明确填写的真实产品数据。未填写的变量（包括尺寸、数量、材质等）不得根据主题、常识、示例或参考图猜测、补齐或编造；省略对应的文字标注和依赖该数据的展示，不把占位符画到图片中。\n本卡为产品尺寸展示主题，也只能标注本提示词中已填写的尺寸；缺少长度等参数时省略该尺寸标注，不用其他尺寸代替。\n未填写变量：[LENGTH]。保持未提供，不填默认值。';
test('旧自动后缀在单卡与多卡组装中移除，保留正文、后续引用卡和产品补充原文', () => {
    const clean = variables.stripLegacyPromptConstraints;
    const original = '原文\n精确尺寸3.2 cm';
    assert.equal(clean(original + '\n\n' + legacyRules), original);
    const extra = variables.PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR + '我的补充\n[原文]  ';
    assert.equal(clean(original + '\n\n' + legacyRules + extra), original + extra);
    assert.equal(clean(original + '\n\n' + legacyRules + '\n\n【第二张卡】\n第二张原文\n\n' + legacyRules), original + '\n\n【第二张卡】\n第二张原文');
    assert.equal(clean(legacyRules), '');
    assert.equal(clean('自定义正文\n\n【变量与画面约束】\n用户自己写的内容'), '自定义正文\n\n【变量与画面约束】\n用户自己写的内容');
    assert.equal(resolvePrompt(original + '\n\n' + legacyRules + extra), original + extra);
});
test('绑定和表单初始化保留别名值，用户显式清空保持空白，型号NA保留', () => {
    const values = { '[productLength]': '73.6 cm', '[MODEL]': 'NA' };
    assert.equal(variables.completePromptVariableValues(['[PRODUCT LENGTH]'], values)['[PRODUCT LENGTH]'], '73.6 cm');
    assert.equal(variables.completePromptVariableValues(['[PRODUCT LENGTH]'], { ...values, '[PRODUCT LENGTH]': '' })['[PRODUCT LENGTH]'], '');
    const params = parameter(values), source = box('source', { content: 'Theme: dimensions\n[PRODUCT LENGTH] [MODEL]' });
    let i = 0;
    const bound = transactions.bindExcelParameters([params, source], [], params.id, source.id, { create: (type, position, metadata) => box('preview', metadata, type), place: node => node, edgeId: () => String(++i) });
    assert.match(beforeRules(bound.nodes.at(-1).metadata.content), /73\.6 cm NA/);
    const metadata = rules.buildPromptVariablesMetadata(undefined, { id: 't', prompts: { detail: source.metadata.content } }, 'detail', values);
    assert.equal(metadata.promptVariableValues['[PRODUCT LENGTH]'], '73.6 cm');
});
test('未识别Excel且无变量时连接普通提示词不自动创建最终提示词卡片', () => {
    const params = parameter({}), source = box('plain', { content: '只添加3.2 cm和6 cm尺寸标注' });
    const fail = () => { throw Error('无变量不应创建预览'); };
    const factory = { create: fail, place: fail, edgeId: () => 'plain-edge' };
    for (const item of [source, box('empty', { content: '' })]) {
        const bound = transactions.bindExcelParameters([params, item], [], params.id, item.id, factory);
        assert.equal(bound.nodes.length, 2); assert.equal(bound.connections.length, 1);
        assert.equal(bound.nodes.find(node => node.id === item.id).metadata.excelPromptBindingNodeId, params.id);
        assert.ok(!bound.nodes.some(node => node.metadata?.promptVariablePreviewOf));
    }
});
test('旧绑定、原文修改与Excel同步均只组装内容，不再生成画面约束', () => {
    const params = parameter({ '[LENGTH]': '73.6 cm', '[COUNT]': '' });
    const source = box('source', { content: 'Theme: lifestyle\n[LENGTH] [COUNT]', excelPromptTemplateId: 't', excelPromptKey: 'detail' });
    let sequence = 0;
    const factory = { create: (type, position, metadata) => ({ ...box('preview-' + ++sequence, metadata, type), position }), place: node => node, edgeId: () => 'edge-' + ++sequence };
    const bound = transactions.bindExcelParameters([params, source], [], params.id, source.id, factory);
    assert.match(bound.nodes.at(-1).metadata.content, /73\.6 cm/); assert.doesNotMatch(bound.nodes.at(-1).metadata.content, /【变量与画面约束】/);
    const edited = bound.nodes.map(n => n.id === 'source' ? { ...n, metadata: { ...n.metadata, content: 'Theme: dimension display\n[LENGTH] [COUNT]' } } : n);
    const reconciled = transactions.reconcileExcelPreviews(bound.nodes, edited);
    assert.match(reconciled.at(-1).metadata.content, /73\.6 cm/); assert.match(reconciled.at(-1).metadata.content, /\[COUNT\]/); assert.doesNotMatch(reconciled.at(-1).metadata.content, /【变量与画面约束】/);
    const updated = sync.syncExcelPromptNodes(reconciled, { templates: [{ id: 't', prompts: { detail: 'Theme: material\n[LENGTH] [COUNT]' } }] }, () => true);
    assert.match(updated.at(-1).metadata.content, /73\.6 cm/); assert.doesNotMatch(updated.at(-1).metadata.content, /【变量与画面约束】/);
});
test('当前生成读取重算源卡和旧缓存，清空参数后不带旧值，不串用其他参数卡', () => {
    const source = box('source', { content: 'Theme: dimension display\n[LENGTH] [COUNT]', excelPromptBindingNodeId: 'parameter', excelPromptResolved: '过期 999 cm' });
    const preview = box('preview', { content: '过期 999 cm', promptVariableSourceNodeId: 'source', promptVariablePreviewOf: 'parameter' });
    const other = box('other', { promptVariableValues: { '[LENGTH]': '888 cm' } }, 'guan:prompt-variables');
    for (const values of [{ '[LENGTH]': '73.6 cm' }, { '[LENGTH]': '' }]) {
        const nodes = [source, preview, parameter(values), other], result = protectedText.readProtectedGenerationText(preview, nodes);
        assert.doesNotMatch(result, /999|888|【变量与画面约束】/); assert.match(result, /\[COUNT\]/);
        assert.equal(beforeRules(result).includes('73.6'), Boolean(values['[LENGTH]']));
        assert.equal(protectedText.readProtectedGenerationText(source, nodes), result);
    }
    assert.equal(protectedText.readProtectedGenerationText(box('image', { content: 'image' }, 'image'), []), undefined);
});

const types = { CanvasNodeType: { Text: 'text', Image: 'image', Video: 'video', Audio: 'audio', Group: 'group', Config: 'config' } };
const i18n = { t: (key, options) => key + (options?.index || '') };
const registry = { getNodeDefinition: type => ({ resource: node => type === 'text' ? { kind: 'text', text: node.metadata?.content } : rules.promptVariablesResource(node) }) };
const referenceModule = await load('.运行/3100源/画布副本/web/src/lib/canvas/canvas-resource-references.ts', {
    '@/lib/image-reference-prompt': { imageReferenceLabel: n => '图' + n }, '@/i18n': i18n, '@/lib/canvas/node-registry': registry, '@/lib/image-utils': {}, '@/services/image-storage': {}, '@/types/canvas': types,
});
const generation = await load('.运行/3100源/画布副本/web/src/components/canvas/canvas-node-generation.ts', {
    '@/i18n': i18n, '@/types/canvas': types, '@/lib/image-reference-prompt': { imageReferenceLabel: n => '图' + n }, '@/lib/canvas/canvas-resource-references': referenceModule,
    '@/lib/canvas/node-registry': registry, '@/services/file-storage': { resolveMediaUrl: (_key, fallback) => fallback },
    '@/扩展功能/提示词/生成文本读取': protectedText, '@/扩展功能/提示词/变量使用规则': variables,
});
const protocol = await load('扩展功能/画布生成/原版图片协议.ts', {
    '@/i18n/index': i18n, nanoid: { nanoid: () => 'id' }, '@/stores/use-config-store': { resolveModelRequestConfig: config => config, resolveModelScript: () => null },
    '@/lib/image-utils': {}, '@/lib/image-reference-prompt': {}, '@/services/image-storage': {}, '../提示词/变量使用规则': variables,
    '../图片设置/图片尺寸规则': await load('扩展功能/图片设置/图片尺寸规则.ts'),
    './参考图数量限制': await load('扩展功能/画布生成/参考图数量限制.ts'),
    '../媒体交付/生成图片尺寸交付.mjs': delivery,
});
test('OpenAI和Gemini最终请求体均剔除历史自动约束，保留用户正文和产品补充；不提交网络请求', async () => {
    const original = '更改一下图片的尺寸，保留3.2 cm和6 cm。';
    const extra = variables.PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR + '用户补充 [原文]';
    for (const apiFormat of ['openai', 'gemini']) {
        const request = await protocol.prepareOriginalImageRequest({
            baseUrl: 'https://example.invalid', model: 'gpt-image-1', count: 1, quality: 'auto',
            size: '1152x1536', systemPrompt: '', apiFormat,
        }, original + '\n\n' + legacyRules + extra);
        const body = JSON.parse(Buffer.from(request.body, 'base64').toString('utf8'));
        const prompt = apiFormat === 'gemini' ? body.contents[0].parts[0].text : body.prompt;
        assert.equal(prompt, original + extra);
    }
});
test('直接输入和composer原文不被追加，旧重试移除自动后缀，未决任务快照保持原样', async () => {
    for (const composer of [false, true]) {
        const prompt = 'Theme: dimensions\n[LENGTH] [QUANTITY]';
        const config = box('direct', composer ? { composerContent: prompt } : {}, 'config');
        const context = generation.buildNodeGenerationContext(config.id, [config], [], prompt);
        assert.equal(context.prompt, prompt);
        const retry = protectedText.readProtectedRetryPrompt('过期 999 cm\n\n' + legacyRules, context.prompt);
        assert.equal(retry, context.prompt); assert.doesNotMatch(retry, /999/);
    }
    assert.equal(protectedText.readProtectedRetryPrompt('历史普通文字', '当前普通文字'), '历史普通文字');
    assert.equal(protectedText.readProtectedRetryPrompt('Theme: dimensions\n[LENGTH]\n\n' + legacyRules, ''), 'Theme: dimensions\n[LENGTH]');
    assert.equal(protectedText.readProtectedRetryPrompt('旧请求\n\n' + legacyRules, '当前原文', true), '旧请求\n\n' + legacyRules);
    // 最后编码端口保护独立调用和孤立旧重试，不触发网络。
    const request = await protocol.prepareOriginalImageRequest({ model: 'gpt-image-1', count: 1, quality: 'auto', size: '1152x1536', systemPrompt: '', apiFormat: 'openai' }, 'Theme: lifestyle\n[LENGTH] [COUNT]');
    assert.equal(JSON.parse(Buffer.from(request.body, 'base64').toString('utf8')).prompt, 'Theme: lifestyle\n[LENGTH] [COUNT]');
});
test('真实引用、分组和composer组装保留实际尺寸及原文，不追加约束或使用旧缓存', async () => {
    const params = parameter({ '[LENGTH]': '73.6 cm', '[QUANTITY]': '' });
    const source = box('source', { content: 'Theme: lifestyle\n[LENGTH] [QUANTITY]', excelPromptBindingNodeId: params.id });
    const preview = box('preview', { content: '过期 999 cm', promptVariableSourceNodeId: source.id, promptVariablePreviewOf: params.id, groupId: 'group' });
    const group = box('group', {}, 'group');
    const results = [];
    for (const composer of [false, true]) for (const grouped of [false, true]) {
        const upstream = grouped ? group : preview;
        const prompt = composer ? `使用 @[node:${upstream.id}]` : '';
        const config = box('config', composer ? { composerContent: prompt } : {}, 'config');
        const context = generation.buildNodeGenerationContext(config.id, [params, source, preview, group, config], [{ fromNodeId: upstream.id, toNodeId: config.id }], prompt);
        assert.match(context.prompt, /\[QUANTITY\]/); assert.match(context.prompt, /73\.6 cm/); assert.doesNotMatch(context.prompt, /999|【变量与画面约束】/); assert.equal(context.textCount, 1);
        const request = await protocol.prepareOriginalImageRequest({ model: 'gpt-image-1', count: 1, quality: 'auto', size: '1152x1536', systemPrompt: '', apiFormat: 'openai' }, context.prompt);
        const body = JSON.parse(Buffer.from(request.body, 'base64').toString('utf8'));
        assert.equal(body.prompt, context.prompt); assert.equal(body.size, '1152x1536'); assert.doesNotMatch(body.prompt, /999|【变量与画面约束】/);
        results.push({ composer, grouped, prompt: body.prompt, size: body.size });
    }
    mkdirSync('.运行/output/产品变量使用验收', { recursive: true });
    writeFileSync('.运行/output/产品变量使用验收/真实生成请求体.json', JSON.stringify(results, null, 2));
});

test('自由补充保留中文、多行和方括号原文，协议复核不重复追加', () => {
    const extra = '保持真实外观。\n不要把 [用户备注] 替换为产品变量。\n  末行保留空格  ';
    const result = variables.resolvePromptVariables('Theme: lifestyle\n[NAME] [LENGTH] [COUNT]', { '[NAME]': '样品', '[LENGTH]': '73 cm' }, extra);
    assert.ok(result.endsWith(extra)); assert.equal(result.split(variables.PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR).length, 2);
    assert.match(result, /73 cm/); assert.match(result, /\[COUNT\]/); assert.doesNotMatch(result, /【变量与画面约束】/);
    assert.equal(variables.resolvePromptVariables(result), result);
    assert.equal(variables.resolvePromptVariables('普通原文', {}, ''), '普通原文');
    assert.equal(variables.resolvePromptVariables('普通原文', {}, ' \n '), '普通原文');
    assert.ok(variables.resolvePromptVariables('相同内容', {}, '相同内容').endsWith('相同内容' + variables.PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR + '相同内容'));
});
test('参数编辑同时更新双向连线的所有提示词与预览，不改原文、未连线和其他参数组', () => {
    const p = parameter({ '[NAME]': '样品' });
    const a = box('a', { content: '主图 [NAME]', excelPromptBindingNodeId: p.id });
    const b = box('b', { content: '详情 [NAME]' });
    const keep = box('keep', { content: '未连线' });
    const foreign = box('foreign', { content: '另一组', excelPromptBindingNodeId: 'other' });
    const image = box('image', { content: 'blob:原图' }, 'image');
    const preview = box('preview', { content: '旧', promptVariablePreviewOf: p.id, promptVariableSourceNodeId: a.id });
    const nodes = [p, a, b, keep, foreign, image, preview], before = structuredClone(nodes);
    const edges = [{ fromNodeId: p.id, toNodeId: b.id }, { fromNodeId: foreign.id, toNodeId: p.id }, { fromNodeId: image.id, toNodeId: p.id }];
    const ops = parameterLinks.buildProductParameterEdits(nodes, edges, p.id, { promptVariableSupplement: '统一补充\n[不是变量]' });
    assert.deepEqual(ops.map(op => op.id), ['parameter', 'a', 'preview', 'b']);
    for (const id of ['a', 'b']) assert.ok(ops.find(op => op.id === id).metadata.excelPromptResolved.endsWith('统一补充\n[不是变量]'));
    assert.ok(ops.find(op => op.id === preview.id).metadata.content.endsWith('统一补充\n[不是变量]'));
    assert.deepEqual(nodes, before); assert.ok(ops.every(op => op.id === preview.id || !Object.hasOwn(op.metadata, 'content')));
    assert.deepEqual(parameterLinks.buildProductParameterEdits(nodes, edges, 'deleted', { promptVariableSupplement: 'x' }), []);
});
test('补充先填写后连线、新增第二条连线，及原文修改均只追加当前补充一次', () => {
    const p = parameter({ '[NAME]': '样品' }); p.metadata.promptVariableSupplement = '统一要求';
    const a = box('a', { content: '主图 [NAME]' }), b = box('b', { content: '详情 [NAME]' });
    let serial = 0;
    const factory = { create: (type, position, metadata) => box('preview-' + ++serial, metadata, type), place: node => node, edgeId: () => 'e' + ++serial };
    const first = transactions.bindExcelParameters([p, a, b], [], p.id, a.id, factory);
    const second = transactions.bindExcelParameters(first.nodes, first.connections, b.id, p.id, factory);
    const previews = second.nodes.filter(n => n.metadata?.promptVariablePreviewOf);
    assert.equal(previews.length, 2);
    for (const n of previews) { assert.ok(n.metadata.content.endsWith('统一要求')); assert.equal(n.metadata.content.split('统一要求').length, 2); }
    const edited = second.nodes.map(n => n.id === a.id ? { ...n, metadata: { ...n.metadata, content: '改写后的原文 [NAME]' } } : n);
    const next = transactions.reconcileExcelPreviews(second.nodes, edited);
    assert.ok(next.find(n => n.metadata?.promptVariableSourceNodeId === a.id && n.metadata?.promptVariablePreviewOf).metadata.content.startsWith('改写后的原文 样品'));
    assert.ok(next.find(n => n.id === a.id).metadata.excelPromptResolved.endsWith('统一要求'));
});
test('补充修改、清空与参数恢复经过原节点协调重算，保留独立原文与未填变量', () => {
    const p = parameter({ '[COUNT]': '' }); p.metadata.promptVariableSupplement = '旧补充';
    const a = box('a', { content: '产品 [COUNT]', excelPromptBindingNodeId: p.id });
    const v = box('v', { content: '旧预览', promptVariablePreviewOf: p.id, promptVariableSourceNodeId: a.id });
    let nodes = [p, a, v];
    for (const extra of ['新补充 [保持原文]', '']) {
        const changed = nodes.map(n => n.id === p.id ? { ...n, metadata: { ...n.metadata, promptVariableSupplement: extra } } : n);
        nodes = transactions.reconcileExcelPreviews(nodes, changed);
        for (const text of [nodes[1].metadata.excelPromptResolved, nodes[2].metadata.content]) {
            assert.doesNotMatch(text, /旧补充|【变量与画面约束】/); assert.match(text, /\[COUNT\]/);
            if (extra) assert.ok(text.endsWith(extra)); else assert.doesNotMatch(text, /【产品补充】|新补充/);
        }
        assert.equal(nodes[1].metadata.content, '产品 [COUNT]');
    }
    const restored = nodes.map(n => n.id === p.id ? { ...n, metadata: { ...n.metadata, promptVariableValues: { '[COUNT]': '2' } } } : n);
    const next = transactions.reconcileExcelPreviews(nodes, restored);
    assert.match(next[2].metadata.content, /^产品 2/);
});
test('Excel来源同步保留补充，最终预览与直接资源读取一致', () => {
    const p = parameter({ '[NAME]': '真实产品' }); p.metadata.promptVariableSupplement = '固定补充';
    const a = box('a', { content: '旧 [NAME]', excelPromptRaw: '旧 [NAME]', excelPromptTemplateId: 't', excelPromptKey: 'main', excelPromptBindingNodeId: p.id });
    const v = box('v', { content: '旧预览', promptVariablePreviewOf: p.id, promptVariableSourceNodeId: a.id });
    const next = sync.syncExcelPromptNodes([p, a, v], { templates: [{ id: 't', prompts: { main: '新 [NAME]' } }] }, () => true);
    assert.equal(next[1].metadata.content, '新 [NAME]');
    assert.ok(next[2].metadata.content.endsWith('固定补充'));
    assert.equal(protectedText.readProtectedGenerationText(next[1], next), next[2].metadata.content);
});
test('普通无变量提示词也附补充，真实生成请求保留原文，修改或清空后的重试不复用旧补充', async () => {
    const p = parameter({}); p.metadata.promptVariableSupplement = '任意补充 [这是备注]\n不要猜测数量';
    const a = box('a', { content: '普通原文', excelPromptBindingNodeId: p.id });
    const v = box('v', { content: '过期缓存', promptVariablePreviewOf: p.id, promptVariableSourceNodeId: a.id });
    const config = box('config', {}, 'config');
    const nodes = [p, a, v, config], edges = [{ fromNodeId: v.id, toNodeId: config.id }];
    const input = generation.buildNodeGenerationInputs(config.id, nodes, edges);
    assert.ok(input[0].text.endsWith(p.metadata.promptVariableSupplement));
    const context = generation.buildNodeGenerationContext(config.id, nodes, edges, '');
    const request = await protocol.prepareOriginalImageRequest({ model: 'gpt-image-1', count: 1, quality: 'auto', size: '1152x1536', systemPrompt: '', apiFormat: 'openai' }, context.prompt);
    const body = JSON.parse(Buffer.from(request.body, 'base64').toString('utf8'));
    assert.equal(body.prompt, context.prompt); assert.equal(body.prompt.split('任意补充').length, 2);
    assert.doesNotMatch(body.prompt, /未填写变量：\[这是备注\]/);
    const cleared = nodes.map(n => n.id === p.id ? { ...n, metadata: { ...n.metadata, promptVariableSupplement: '' } } : n);
    const current = protectedText.readProtectedGenerationText(a, cleared);
    assert.equal(current, '普通原文'); assert.equal(protectedText.readProtectedRetryPrompt(body.prompt, current), current);
    const next = variables.resolvePromptVariables('普通原文', {}, '修改的补充');
    assert.equal(protectedText.readProtectedRetryPrompt(body.prompt, next), next);
});
test('编辑操作每次读最新卡片，补充不倒灌产品变量记忆，删除后迟到输入不写入', async () => {
    let nodes = [parameter({ '[COUNT]': '' })]; const saved = [], commits = [];
    const editing = await load('扩展功能/Excel画布/产品参数编辑操作.ts', {
        react: { useCallback: callback => callback }, './产品参数联动': parameterLinks,
        './Excel参数记忆': { saveProductParameterValues: (...args) => saved.push(args) },
    });
    const ctx = { node: nodes[0], getNodes: () => nodes, getConnections: () => [], getNode: id => nodes.find(n => n.id === id),
        applyOps: ops => { commits.push(ops); nodes = nodes.map(n => ({ ...n, metadata: { ...n.metadata, ...ops.find(op => op.id === n.id)?.metadata } })); } };
    const api = editing.useProductParameterEditing(ctx, 'product', ['[COUNT]']);
    api.updateSupplement('补充'); api.updateValue('[COUNT]', '2');
    assert.equal(nodes[0].metadata.promptVariableSupplement, '补充'); assert.equal(nodes[0].metadata.promptVariableValues['[COUNT]'], '2');
    assert.deepEqual(saved, [['product', { '[COUNT]': '2' }]]);
    nodes = []; api.updateSupplement('迟到'); api.updateValue('[COUNT]', '3'); assert.equal(commits.length, 2); assert.equal(saved.length, 1);
});

test('未绑定普通文本中的既有补充不会因资源读取被删除', () => {
    const text = variables.resolvePromptVariables('普通原文', {}, '保留原备注');
    const standalone = box('standalone', { content: text });
    assert.equal(protectedText.readProtectedGenerationText(standalone, [standalone]), text);
});
