import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

async function load(file, dependencies = {}) {
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
const rules = await load('扩展功能/Excel画布/旧版参数规则.ts', { './旧版主题翻译.js': themes, '../提示词/变量使用规则': variables });
const protectedText = await load('扩展功能/提示词/生成文本读取.ts', { './变量使用规则': variables });
const contexts = await load('扩展功能/Excel画布/Excel卡片上下文.ts', { './旧版参数规则': rules });
const titles = await load('扩展功能/Excel画布/旧版最终提示词标题.ts');
const parameterLinks = await load('扩展功能/Excel画布/产品参数联动.ts', { '../提示词/变量使用规则': variables, './旧版最终提示词标题': titles });
const transactions = await load('扩展功能/Excel画布/Excel卡片事务.ts', { './旧版参数规则': rules, './产品参数联动': parameterLinks, './旧版最终提示词标题': titles, './Excel卡片上下文': contexts });
const sync = await load('扩展功能/Excel画布/旧版提示词同步.ts', { './旧版参数规则': rules });
const beforeRules = text => text.split('\n\n【变量与画面约束】')[0];
const box = (id, metadata = {}, type = 'text') => ({ id, title: id, type, position: { x: 0, y: 0 }, width: 340, height: 240, metadata });
const parameter = values => box('parameter', { promptVariableValues: values }, 'guan:prompt-variables');

test('尺寸主题空长度、数量、材质均保留未提供，不能从主题编造', () => {
    const result = resolvePrompt('Theme: dimensions display\nLength: [LENGTH]; Count: [QUANTITY]; Material: [MATERIAL]', { '[LENGTH]': ' ', '[QUANTITY]': '', '[MATERIAL]': '' });
    assert.match(beforeRules(result), /\[LENGTH\].*\[QUANTITY\].*\[MATERIAL\]/);
    assert.match(result, /未填写变量：\[LENGTH\]、\[QUANTITY\]、\[MATERIAL\]/);
    assert.match(result, /省略该尺寸标注/); assert.match(result, /不得根据主题、常识、示例或参考图猜测/);
});
test('0是已填写真实值，别名大小写和分隔符可替换，未用共享参数不追加', () => {
    const result = resolvePrompt('Theme: dimensions display\n[product_length] [QUANTITY] [NAME]', { '[PRODUCT LENGTH]': '0 cm', '[QUANTITY]': '0', '[NAME]': '样品', '[WIDTH]': '878 cm' });
    assert.match(beforeRules(result), /0 cm 0 样品/); assert.doesNotMatch(result, /878/);
    assert.doesNotMatch(result, /未填写变量/);
});
test('显式清空不会退回旧别名，待填写等占位值不算确认数据', () => {
    const result = resolvePrompt('Theme: dimension display\n[LENGTH] [COUNT] [MATERIAL]', { '[LENGTH]': '', '[length]': '88 cm', '[COUNT]': '待填写', '[MATERIAL]': '[MATERIAL]' });
    assert.doesNotMatch(result, /88 cm/); assert.match(result, /未填写变量：\[LENGTH\]、\[COUNT\]、\[MATERIAL\]/);
});
for (const theme of ['lifestyle scene', '材质结构', 'core selling points', '规格参数介绍', 'scale of business', 'without dimension annotations', '非尺寸展示主题', '尺寸以外的使用场景，不显示尺寸']) {
    test('非尺寸主题不带入共享尺寸值：' + theme, () => {
        const result = resolvePrompt(`Theme: ${theme}\nPRODUCT DATA: [LENGTH] [WIDTH] [DIMENSIONS]\nOutput: 1152 x 1536 px 3:4`, { '[LENGTH]': '73.6 cm', '[WIDTH]': '48.3 cm', '[DIMENSIONS]': '73.6 x 48.3 cm' });
        assert.doesNotMatch(result, /73\.6|48\.3/); assert.match(result, /不是产品尺寸展示主题/);
        assert.match(result, /1152 x 1536 px 3:4/);
    });
}
for (const theme of ['dimension display', 'product size chart', 'size chart', '长度展示', '尺寸规格', 'measurement diagram']) {
    test('明确尺寸主题允许已有的真实尺寸：' + theme, () => {
        const result = resolvePrompt(`主题：${theme}\n[LENGTH] [WIDTH]`, { '[LENGTH]': '73.6 cm' });
        assert.match(beforeRules(result), /73\.6 cm \[WIDTH\]/); assert.match(result, /本卡为产品尺寸展示主题/);
        assert.match(result, /未填写变量：\[WIDTH\]/);
    });
}
test('Theme优先于COMPOSITION LOCK，公共数据和通用说明不参与主题识别', () => {
    for (const prompt of ['COMPOSITION LOCK: dimension chart\nTheme: lifestyle\n[LENGTH]', 'Theme: lifestyle\nCOMPOSITION LOCK: dimensions\n[LENGTH]', 'PRODUCT DATA: dimensions: [LENGTH]\nSAFETY RULES: show size chart']) {
        const result = resolvePrompt(prompt, { '[LENGTH]': '73.6 cm' });
        assert.doesNotMatch(result, /73\.6/); assert.match(result, /不是产品尺寸展示主题/);
    }
});
test('主题变量有真实值时可识别，但输出像素宽高不当产品尺寸', () => {
    const result = resolvePrompt('Theme: [FOCUS]\n[LENGTH]\n[IMAGE WIDTH] x [OUTPUT HEIGHT] px', { '[FOCUS]': 'dimensions', '[LENGTH]': '73.6 cm', '[IMAGE WIDTH]': '1152', '[OUTPUT HEIGHT]': '1536' });
    assert.match(beforeRules(result), /73\.6 cm\n1152 x 1536 px/);
    assert.match(resolvePrompt('Theme: image width and height\n[LENGTH]', { '[LENGTH]': '73.6 cm' }), /不是产品尺寸展示主题/);
});
test('只处理变量，不把节点引用、分镜时间和普通文字当产品数据', () => {
    const plain = '@[node:abc] [1] [0-5秒] [PRODUCT PHOTO/CAD]';
    assert.equal(resolvePrompt(plain, { '[1]': 'wrong' }), plain); assert.equal(resolvePrompt(''), ''); assert.equal(resolvePrompt('普通文字'), '普通文字');
    const once = resolvePrompt('Theme: lifestyle\n[LENGTH] [NAME]', { '[LENGTH]': '73.6 cm' });
    assert.equal(resolvePrompt(once), once);
});
test('没有任何尺寸数据的尺寸展示卡仍明确禁止猜测', () => {
    assert.match(resolvePrompt('Theme: dimensions display'), /省略该尺寸标注/);
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
test('首次绑定、修改原文、Excel来源更新均同步同一套约束', () => {
    const params = parameter({ '[LENGTH]': '73.6 cm', '[COUNT]': '' });
    const source = box('source', { content: 'Theme: lifestyle\n[LENGTH] [COUNT]', excelPromptTemplateId: 't', excelPromptKey: 'detail' });
    let sequence = 0;
    const factory = { create: (type, position, metadata) => ({ ...box('preview-' + ++sequence, metadata, type), position }), place: node => node, edgeId: () => 'edge-' + ++sequence };
    const bound = transactions.bindExcelParameters([params, source], [], params.id, source.id, factory);
    assert.doesNotMatch(bound.nodes.at(-1).metadata.content, /73\.6/);
    const edited = bound.nodes.map(n => n.id === 'source' ? { ...n, metadata: { ...n.metadata, content: 'Theme: dimension display\n[LENGTH] [COUNT]' } } : n);
    const reconciled = transactions.reconcileExcelPreviews(bound.nodes, edited);
    assert.match(reconciled.at(-1).metadata.content, /73\.6 cm/); assert.match(reconciled.at(-1).metadata.content, /未填写变量：\[COUNT\]/);
    const updated = sync.syncExcelPromptNodes(reconciled, { templates: [{ id: 't', prompts: { detail: 'Theme: material\n[LENGTH] [COUNT]' } }] }, () => true);
    assert.doesNotMatch(updated.at(-1).metadata.content, /73\.6/); assert.match(updated.at(-1).metadata.content, /不是产品尺寸展示主题/);
});
test('当前生成读取重算源卡和旧缓存，清空参数后不带旧值，不串用其他参数卡', () => {
    const source = box('source', { content: 'Theme: dimension display\n[LENGTH] [COUNT]', excelPromptBindingNodeId: 'parameter', excelPromptResolved: '过期 999 cm' });
    const preview = box('preview', { content: '过期 999 cm', promptVariableSourceNodeId: 'source', promptVariablePreviewOf: 'parameter' });
    const other = box('other', { promptVariableValues: { '[LENGTH]': '888 cm' } }, 'guan:prompt-variables');
    for (const values of [{ '[LENGTH]': '73.6 cm' }, { '[LENGTH]': '' }]) {
        const nodes = [source, preview, parameter(values), other], result = protectedText.readProtectedGenerationText(preview, nodes);
        assert.doesNotMatch(result, /999|888/); assert.match(result, /未填写变量/);
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
    '@/lib/canvas/node-registry': registry, '@/扩展功能/提示词/生成文本读取': protectedText, '@/扩展功能/提示词/变量使用规则': variables,
});
const protocol = await load('扩展功能/画布生成/原版图片协议.ts', {
    '@/i18n/index': i18n, nanoid: { nanoid: () => 'id' }, '@/stores/use-config-store': { resolveModelRequestConfig: config => config, resolveModelScript: () => null },
    '@/lib/image-utils': {}, '@/lib/image-reference-prompt': {}, '@/services/image-storage': {}, '../提示词/变量使用规则': variables,
    '../图片设置/图片尺寸规则': await load('扩展功能/图片设置/图片尺寸规则.ts'),
});
test('直接输入和无资源composer同样保护缺值，重试使用当前可追溯变量而非旧快照', async () => {
    for (const composer of [false, true]) {
        const prompt = 'Theme: dimensions\n[LENGTH] [QUANTITY]';
        const config = box('direct', composer ? { composerContent: prompt } : {}, 'config');
        const context = generation.buildNodeGenerationContext(config.id, [config], [], prompt);
        assert.match(context.prompt, /未填写变量：\[LENGTH\]、\[QUANTITY\]/);
        const retry = protectedText.readProtectedRetryPrompt('过期 999 cm', context.prompt);
        assert.equal(retry, context.prompt); assert.doesNotMatch(retry, /999/);
    }
    assert.equal(protectedText.readProtectedRetryPrompt('历史普通文字', '当前普通文字'), '历史普通文字');
    assert.match(protectedText.readProtectedRetryPrompt('Theme: dimensions\n[LENGTH]', ''), /省略该尺寸标注/);
    // 最后编码端口保护独立调用和孤立旧重试，不触发网络。
    const request = await protocol.prepareOriginalImageRequest({ model: 'gpt-image-1', count: 1, quality: 'auto', size: '1152x1536', systemPrompt: '', apiFormat: 'openai' }, 'Theme: lifestyle\n[LENGTH] [COUNT]');
    assert.match(JSON.parse(Buffer.from(request.body, 'base64').toString('utf8')).prompt, /不是产品尺寸展示主题/);
});
test('真实资源图、分组和composer两路组装后，实际图片请求体不含非主题尺寸或旧缓存', async () => {
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
        assert.match(context.prompt, /未填写变量：\[QUANTITY\]/); assert.doesNotMatch(context.prompt, /73\.6|999/); assert.equal(context.textCount, 1);
        const request = await protocol.prepareOriginalImageRequest({ model: 'gpt-image-1', count: 1, quality: 'auto', size: '1152x1536', systemPrompt: '', apiFormat: 'openai' }, context.prompt);
        const body = JSON.parse(Buffer.from(request.body, 'base64').toString('utf8'));
        assert.equal(body.prompt, context.prompt); assert.equal(body.size, '1152x1536'); assert.doesNotMatch(body.prompt, /73\.6|999/);
        results.push({ composer, grouped, prompt: body.prompt, size: body.size });
    }
    mkdirSync('.运行/output/产品变量使用验收', { recursive: true });
    writeFileSync('.运行/output/产品变量使用验收/真实生成请求体.json', JSON.stringify(results, null, 2));
});

test('自由补充保留中文、多行和方括号原文，位于变量约束后且协议复核不重复追加', () => {
    const extra = '保持真实外观。\n不要把 [用户备注] 替换为产品变量。\n  末行保留空格  ';
    const result = variables.resolvePromptVariables('Theme: lifestyle\n[NAME] [LENGTH] [COUNT]', { '[NAME]': '样品', '[LENGTH]': '73 cm' }, extra);
    assert.ok(result.endsWith(extra)); assert.equal(result.split(variables.PRODUCT_PROMPT_SUPPLEMENT_SEPARATOR).length, 2);
    assert.doesNotMatch(result, /73 cm/); assert.match(result, /未填写变量：\[COUNT\]/);
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
            assert.doesNotMatch(text, /旧补充/); assert.match(text, /未填写变量：\[COUNT\]/);
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
