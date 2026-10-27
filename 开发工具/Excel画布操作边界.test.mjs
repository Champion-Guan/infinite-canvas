import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function load(name, dependencies = {}, extra = {}) {
    const file = resolve(root, '扩展功能', name);
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file,
        { loader: name.endsWith('.js') ? 'js' : 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(extra), code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports, ...Object.values(extra));
    return module.exports;
}
// 使用当前根目录的真实规则和事务；只替代浏览器确认、React调度及SQLite偏好端口。
const themes = await load('Excel画布/旧版主题翻译.js');
const variableRules = await load('提示词/变量使用规则.ts');
const rules = await load('Excel画布/旧版参数规则.ts', { './旧版主题翻译.js': themes, '../提示词/变量使用规则': variableRules });
const contexts = await load('Excel画布/Excel卡片上下文.ts', { './旧版参数规则': rules });
const titles = await load('Excel画布/旧版最终提示词标题.ts');
const parameterLinks = await load('Excel画布/产品参数联动.ts', { '../提示词/变量使用规则': variableRules, './旧版最终提示词标题': titles });
const domain = await load('Excel画布/Excel卡片事务.ts', {
    './旧版参数规则': rules, './产品参数联动': parameterLinks, './旧版最终提示词标题': titles, './Excel卡片上下文': contexts,
});
const sync = await load('Excel画布/旧版提示词同步.ts', { './旧版参数规则': rules });
const drops = await load('Excel画布/Excel拖入校验.ts');
const placement = await load('画布布局/卡片自动避让.ts');
const modes = await load('安全与批量/prompt-generation-mode.ts');
const generation = await load('画布生成/生成参数继承.ts', {
    '@/types/canvas': { CanvasNodeType: { Text: 'text', Config: 'config' } },
    '@/lib/canvas/canvas-generation-helpers': { getGenerationCount: value => Math.max(1, Number(value) || 1) },
    '../安全与批量/prompt-generation-mode': modes,
});
const context = () => ({ productId: 'a', fileName: '测试.xlsx', activeProductName: '产品A', templates: [{ id: 't', route: '产品A',
    prompts: { 'Main Prompt': 'Theme: full product hero\n[PRODUCT NAME]', 'Detail Prompt 01': 'Theme: dimension display\n[LENGTH] [QUANTITY]', 'Video Prompt': 'Video [PRODUCT NAME]' } }] });
function node(id, type = 'text', metadata = {}) {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 340, height: 240, metadata };
}
async function canvas(overrides = {}, initial = []) {
    const effects = [], errors = [], warnings = [], commits = [], memoryReads = [];
    const preferences = new Map();
    const memory = await load('Excel画布/Excel参数记忆.ts', {
        '../本机存储/上游浏览器存储桥': { sqlitePreferences: { getItem: key => { memoryReads.push(key); return preferences.get(key) ?? null; }, setItem: (key, value) => preferences.set(key, value) } },
    });
    const hooks = { useCallback: callback => callback, useEffect: effect => effects.push(effect) };
    const insertion = await load('Excel画布/Excel插入操作.ts', {
        react: hooks, './Excel卡片事务': domain, './旧版提示词同步': sync, './Excel拖入校验': drops,
    }, { window: { confirm: () => { api.confirmations++; return api.answer; } } });
    const parameters = await load('Excel画布/Excel参数操作.ts', {
        react: hooks, './Excel卡片事务': domain, './Excel参数记忆': memory,
    });
    let sequence = 0;
    const factory = { create: (type, center, metadata) => ({ ...node('new-' + ++sequence, type, metadata), position: center }),
        edgeId: () => 'edge-' + ++sequence, place: placement.placeCanvasNode };
    const port = { projectId: 'a', productActive: true, projectLoaded: true, restoredProjectIdRef: { current: 'a' }, excelContext: context(),
        nodesRef: { current: initial }, connectionsRef: { current: [] }, factory, getCanvasCenter: () => ({ x: 500, y: 200 }),
        setNodes: update => {
            const previous = port.nodesRef.current;
            port.nodesRef.current = placement.placeNewCanvasNodes(previous, domain.reconcileExcelPreviews(previous, typeof update === 'function' ? update(previous) : update));
            commits.push('nodes');
        },
        setConnections: value => { assert.equal(port.connectionsRef.current, value, '连线引用必须在React提交前同步'); commits.push('connections'); },
        setSelectedNodeIds: ids => { api.selected = ids; }, setSelectedConnectionId: id => { api.selectedConnection = id; },
        message: { error: text => errors.push(text), warning: text => warnings.push(text) }, ...overrides };
    const api = { port, effects, errors, warnings, commits, preferences, memoryReads, confirmations: 0, answer: false,
        render() { effects.length = 0; Object.assign(api, insertion.useExcelCanvasInsertion(port), parameters.useExcelParameterOperations(port)); } };
    api.render(); return api;
}

test('隐藏产品、未加载、恢复身份或Excel身份不匹配时不插入、不改选择与连线', async () => {
    for (const overrides of [{ productActive: false }, { projectLoaded: false }, { restoredProjectIdRef: { current: 'b' } }, { excelContext: { ...context(), productId: 'b' } }]) {
        const api = await canvas(overrides, [node('保留')]);
        api.insertExcelCards({ productId: 'a' });
        assert.deepEqual(api.commits, []); assert.equal(api.selected, undefined); assert.equal(api.port.nodesRef.current[0].id, '保留');
    }
});
test('跨产品、缺列身份和不存在的列插入失败时保留原画布', async () => {
    const api = await canvas({}, [node('保留')]);
    for (const request of [{ productId: 'b' }, { productId: 'a', key: 'Main Prompt' }, { productId: 'a', templateId: 't', key: 'missing' }]) api.insertExcelCards(request);
    assert.equal(api.errors.length, 3); assert.deepEqual(api.commits, []);
});
test('批量插入沿用真实事务：默认跳过视频、同步绑定预览、重复导入不增加节点', async () => {
    const api = await canvas();
    api.preferences.set('guan-canvas-parameter-values:a', JSON.stringify({ '[PRODUCT NAME]': '真实产品' }));
    const parameter = api.createParameterNode({ x: -500, y: 0 });
    api.port.nodesRef.current = [parameter];
    api.insertExcelCards({ productId: 'a' });
    assert.equal(api.port.nodesRef.current.length, 5); assert.equal(api.port.connectionsRef.current.length, 4);
    assert.equal(api.selected.size, 2); assert.equal(api.selectedConnection, null);
    assert.ok(api.port.nodesRef.current.some(n => n.metadata?.promptVariablePreviewOf && n.metadata.content.includes('真实产品')));
    const detail = api.port.nodesRef.current.find(n => n.metadata?.promptVariablePreviewOf && n.metadata.content.includes('[LENGTH]'));
    assert.ok(detail.metadata.content.includes('[QUANTITY]')); assert.match(detail.metadata.content, /未填写变量：\[LENGTH\]、\[QUANTITY\]/);
    api.insertExcelCards({ productId: 'a' });
    assert.equal(api.port.nodesRef.current.length, 5); assert.equal(api.port.connectionsRef.current.length, 4);
    api.insertExcelCards({ productId: 'a', includeVideo: true });
    assert.equal(api.port.nodesRef.current.length, 7); assert.equal(api.port.connectionsRef.current.length, 6);
});
test('普通拖入交回作者流程，畸形Excel拖入被消费并提示，不变为整批插入', async () => {
    const api = await canvas();
    assert.equal(api.dropExcelCards('', { x: 0, y: 0 }), false);
    for (const raw of ['{', 'null', '[]', '{}', JSON.stringify({ productId: 'a', templateId: 't', key: '' }), JSON.stringify({ productId: 'a', templateId: 't', key: 1 })]) {
        assert.equal(api.dropExcelCards(raw, { x: 0, y: 0 }), true);
    }
    assert.equal(api.warnings.length, 6); assert.deepEqual(api.commits, []);
    assert.equal(api.dropExcelCards(JSON.stringify({ productId: 'a', templateId: 't', key: 'Main Prompt', includeVideo: true }), { x: 900, y: 200 }), true);
    assert.equal(api.port.nodesRef.current.length, 1); assert.equal(api.port.nodesRef.current[0].metadata.excelPromptKey, 'Main Prompt');
});
test('来源更新保留手工编辑：隐藏画布延后确认，拒绝后不再重复询问', async () => {
    const source = node('source', 'text', { content: '手工编辑', excelPromptRaw: '旧来源', excelPromptKey: 'Main Prompt', excelPromptTemplateId: 't' });
    const api = await canvas({ productActive: false }, [source]);
    api.effects[0](); assert.equal(api.confirmations, 0); assert.deepEqual(api.commits, []);
    api.port.productActive = true; api.render(); api.effects[0]();
    assert.equal(api.confirmations, 1); assert.equal(api.port.nodesRef.current[0].metadata.content, '手工编辑');
    api.effects[0](); assert.equal(api.confirmations, 1);
});
test('确认Excel来源更新后同步最终预览，节点ID和位置保留', async () => {
    const api = await canvas();
    const parameter = api.createParameterNode({ x: -500, y: 0 });
    api.port.nodesRef.current = [parameter]; api.insertExcelCards({ productId: 'a', templateId: 't', key: 'Main Prompt' });
    const source = api.port.nodesRef.current.find(n => n.metadata?.excelPromptKey);
    api.bindParameterConnection(parameter.id, source.id);
    const before = structuredClone(api.port.nodesRef.current);
    api.port.setNodes(nodes => nodes.map(n => n.id === source.id ? { ...n, metadata: { ...n.metadata, content: '手工原文' } } : n));
    api.port.excelContext = context(); api.port.excelContext.templates[0].prompts['Main Prompt'] = '新Excel [PRODUCT NAME]';
    api.answer = true; api.render(); api.effects[0]();
    assert.equal(api.confirmations, 1);
    for (const n of before) assert.deepEqual(api.port.nodesRef.current.find(x => x.id === n.id).position, n.position);
    assert.match(api.port.nodesRef.current.find(n => n.metadata?.promptVariablePreviewOf).metadata.content, /^新Excel \[PRODUCT NAME\][\s\S]*未填写变量/);
});
test('画布恢复身份不符时来源同步不触碰旧节点', async () => {
    const api = await canvas({ restoredProjectIdRef: { current: 'b' } }, [node('source', 'text', { content: '旧', excelPromptRaw: '旧', excelPromptKey: 'Main Prompt', excelPromptTemplateId: 't' })]);
    api.effects[0](); assert.deepEqual(api.commits, []);
});
test('参数创建使用稳定产品ID；损坏的参数记忆不作为空值覆盖', async () => {
    const api = await canvas(); api.preferences.set('guan-canvas-parameter-values:a', '{');
    assert.throws(() => api.createParameterNode({ x: 0, y: 0 }), /记忆损坏/);
    api.preferences.set('guan-canvas-parameter-values:a', JSON.stringify({ '[NAME]': 12 }));
    assert.throws(() => api.createParameterNode({ x: 0, y: 0 }), /格式异常/);
    assert.ok(api.memoryReads.every(key => key === 'guan-canvas-parameter-values:a')); assert.deepEqual(api.commits, []);
});
test('参数连接保留现有卡片位置；冲突不提交，解绑只移除对应最终预览', async () => {
    const api = await canvas(); const p = api.createParameterNode({ x: -500, y: 0 });
    const source = node('source', 'text', { content: '[LENGTH] [QUANTITY]' });
    const keep = node('keep', 'image'); api.port.nodesRef.current = [p, source, keep];
    assert.equal(api.bindParameterConnection(p.id, source.id), true);
    const preview = api.port.nodesRef.current.find(n => n.metadata?.promptVariablePreviewOf);
    assert.match(preview.metadata.content, /未填写变量：\[LENGTH\]、\[QUANTITY\]/);
    assert.deepEqual(api.port.nodesRef.current.find(n => n.id === source.id).position, source.position);
    const count = api.commits.length, other = api.createParameterNode({ x: -1000, y: 0 });
    assert.throws(() => api.bindParameterConnection(other.id, source.id, [...api.port.nodesRef.current, other]), /已连接另一张参数卡/);
    assert.equal(api.commits.length, count);
    const edge = api.port.connectionsRef.current.find(e => e.fromNodeId === p.id);
    assert.equal(api.disconnectParameterConnection(edge.id), true);
    assert.deepEqual(api.port.nodesRef.current.map(n => n.id), [p.id, source.id, keep.id]);
    assert.equal(api.port.nodesRef.current.find(n => n.id === source.id).metadata.excelPromptBindingNodeId, undefined);
    assert.equal(api.port.connectionsRef.current.length, 0);
});
test('普通节点连线与断线不由Excel操作提交，新增草稿绑定可在同一事务完成', async () => {
    const api = await canvas({}, [node('a'), node('b')]);
    assert.equal(api.bindParameterConnection('a', 'b'), false);
    api.port.connectionsRef.current = [{ id: 'normal', fromNodeId: 'a', toNodeId: 'b' }];
    assert.equal(api.disconnectParameterConnection('normal'), false); assert.deepEqual(api.commits, []);
    const p = api.createParameterNode({ x: -500, y: 0 }); api.port.nodesRef.current = [p];
    const draft = node('draft', 'text', { content: '[MISSING]' });
    assert.equal(api.bindParameterConnection(p.id, draft.id, [p, draft]), true);
    assert.equal(api.port.nodesRef.current.length, 3); assert.equal(api.port.connectionsRef.current.length, 3);
});
test('连线识别保留未识别配置；切换生成类型才换模型，识别图片尺寸不改质量', () => {
    const config = { imageModel: '图片模型', videoModel: '视频模型', audioModel: '音频模型', textModel: '文本模型' };
    const prompt = node('p', 'text', { content: '普通提示词' }), target = node('c', 'config', { model: '客户模型', size: '客户尺寸', quality: 'high' });
    const original = [prompt, target];
    assert.equal(generation.applyConnectedPromptConfig(original, [], 'p', 'c', config), original);
    for (const [title, mode] of [['视频提示词', 'video'], ['音频提示词', 'audio'], ['文本提示词', 'text']]) {
        const source = { ...prompt, title }, value = generation.applyConnectedPromptConfig([source, target], [], 'c', 'p', config);
        assert.equal(value[1].metadata.generationMode, mode); assert.equal(value[1].metadata.model, config[mode + 'Model']); assert.equal(value[1].metadata.quality, 'high');
    }
    const sized = { ...prompt, metadata: { content: '3:4, 1152 x 1536 px MAIN IMAGE' } };
    const result = generation.applyConnectedPromptConfig([sized, target], [], 'p', 'c', config);
    assert.equal(result[1].metadata.size, '1152x1536'); assert.equal(result[1].metadata.model, '客户模型');
    assert.equal(result[1].metadata.generationParamsSourceNodeId, 'p'); assert.equal(target.metadata.size, '客户尺寸');
});
