import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function load(name, dependencies = {}, extra = {}) {
    const file = resolve(root, '扩展功能', name);
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, {
        loader: name.endsWith('.tsx') ? 'tsx' : name.endsWith('.js') ? 'js' : 'ts', jsx: 'automatic', format: 'cjs', target: 'es2022', tsconfigRaw: '{}',
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(extra), code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id); return dependencies[id];
    }, module, module.exports, ...Object.values(extra));
    return module.exports;
}
const types = { CanvasNodeType: { Text: 'text', Config: 'config', Image: 'image', Video: 'video', Audio: 'audio' } };
const hooks = { useCallback: callback => callback, useRef: value => ({ current: value }), useEffect: () => {} };
const modes = await load('安全与批量/prompt-generation-mode.ts');
const detected = await load('画布生成/生成参数继承.ts', {
    '@/types/canvas': types, '@/lib/canvas/canvas-generation-helpers': { getGenerationCount: value => Math.max(1, Number(value) || 1) },
    '../安全与批量/prompt-generation-mode': modes,
});
const placement = await load('画布布局/卡片自动避让.ts');
const node = (id, metadata = {}, type = 'text') => ({ id, type, title: id, position: { x: 20, y: 40 }, width: 340, height: 240, metadata });
async function fixture(kind, initial = []) {
    const warnings = [], errors = [], requests = [], effects = [], timers = new Map(), selected = [], order = [];
    let sequence = 0, valid = true, ready = true;
    const port = {
        projectId: 'a', nodesRef: { current: initial }, connectionsRef: { current: [] }, effectiveConfig: { imageModel: '图片', videoModel: '视频', textModel: '文本', size: '默认尺寸', count: 2 },
        generateNodeRef: { current: async (...args) => { requests.push(args); } },
        isAiConfigReady: () => ready, openConfigDialog: value => { api.dialog = value; },
        assertImportTarget: () => { if (!valid) throw Error('原画布已切换'); },
        setNodes: value => { port.nodesRef.current = placement.placeNewCanvasNodes(port.nodesRef.current, typeof value === 'function' ? value(port.nodesRef.current) : value); order.push('nodes'); },
        setConnections: value => { assert.equal(port.connectionsRef.current, value); order.push('connections'); },
        setSelectedNodeIds: value => { selected.push([...value]); }, setSelectedConnectionId: value => { api.selectedConnection = value; }, setDialogNodeId: value => { api.nodeDialog = value; },
        message: { warning: value => warnings.push(value), error: value => errors.push(value) }, emptyPromptMessage: '提示词为空',
    };
    const dependencies = { react: { ...hooks, useEffect: callback => effects.push(callback) }, '@/types/canvas': types,
        '@/lib/canvas/canvas-node-factory': { createCanvasNode: (type, center, metadata) => ({ ...node('new-' + ++sequence, metadata, type), position: center }) },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: (_config, _node, mode) => ({ model: mode === 'text' ? '文本' : '图片' }) },
        '@/constant/canvas': { getNodeSpec: () => ({ width: 340, height: 240 }) }, './生成参数继承': detected, nanoid: { nanoid: () => 'edge-' + ++sequence } };
    const mod = await load('画布生成/' + (kind === 'translation' ? '提示词翻译操作.ts' : '单卡配置创建.ts'), dependencies, {
        setTimeout: callback => { const timer = ++sequence; timers.set(timer, callback); return timer; }, clearTimeout: timer => timers.delete(timer),
    });
    const api = { port, warnings, errors, requests, effects, timers, selected, order, setValid: value => { valid = value; }, setReady: value => { ready = value; },
        async flush() { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); await new Promise(resolve => setImmediate(resolve)); } };
    api.run = kind === 'translation' ? mod.usePromptTranslation(port) : mod.useSinglePromptConfig(port);
    return api;
}
test('翻译使用当前源卡原文与占位符，建卡关联后才走原文本入口，重复点击不重复提交', async () => {
    const current = node('source', { content: '  准确的产品 [LENGTH] [QUANTITY]  ' });
    const api = await fixture('translation', [current]); api.run({ ...current, metadata: { content: '过期内容' } }, 'en');
    assert.deepEqual(api.order, ['nodes', 'connections']); assert.equal(api.requests.length, 0);
    const target = api.port.nodesRef.current[1]; assert.equal(target.title, '英文最终生图提示词'); assert.equal(target.metadata.promptVariableTranslationOf, current.id);
    api.run(current, 'en'); assert.equal(api.port.nodesRef.current.length, 2);
    await api.flush(); assert.equal(api.requests.length, 1); assert.equal(api.requests[0][0], target.id); assert.equal(api.requests[0][1], 'text');
    assert.match(api.requests[0][2], /准确的产品 \[LENGTH\] \[QUANTITY\]/); assert.doesNotMatch(api.requests[0][2], /过期内容/);
});
test('中文和英文译文分别保留；已有译文只定位，不重新生成', async () => {
    const source = node('source', { content: '原文' }), en = node('en', { promptVariableTranslationOf: 'source', promptVariableTranslationLanguage: 'en', content: '已有译文' });
    const api = await fixture('translation', [source, en]); api.run(source, 'en');
    assert.deepEqual(api.selected, [['en']]); assert.equal(api.timers.size, 0);
    api.run(source, 'zh'); await api.flush(); assert.equal(api.port.nodesRef.current[2].title, '中文最终生图提示词');
    assert.match(api.requests[0][2], /翻译成自然、准确的简体中文/);
});
test('翻译源卡缺失或空白不建卡，模型未配置只打开原设置', async () => {
    const api = await fixture('translation', [node('empty', { content: ' ' }), node('source', { content: '正文' })]);
    api.run(node('deleted'), 'en'); api.run(api.port.nodesRef.current[0], 'en'); api.setReady(false); api.run(api.port.nodesRef.current[1], 'en');
    assert.equal(api.warnings.length, 1); assert.equal(api.dialog, true); assert.deepEqual(api.order, []); assert.equal(api.requests.length, 0);
});
test('延迟翻译前切画布、删除源/目标或修改原文时不发请求', async () => {
    for (const change of ['switch', 'source', 'target', 'edit', 'started']) {
        const source = node('source', { content: '正文' }), api = await fixture('translation', [source]); api.run(source, 'en');
        if (change === 'switch') api.setValid(false);
        if (change === 'source') api.port.nodesRef.current = api.port.nodesRef.current.filter(n => n.id !== source.id);
        if (change === 'target') api.port.nodesRef.current = [source];
        if (change === 'edit') api.port.nodesRef.current[0] = { ...source, metadata: { content: '已改原文' } };
        if (change === 'started') api.port.nodesRef.current[1].metadata.status = 'loading';
        await api.flush(); assert.equal(api.requests.length, 0, change);
    }
});
test('翻译生命周期清理取消未提交计时器；提交入口失败有明确提示', async () => {
    const source = node('source', { content: '正文' }), api = await fixture('translation', [source]);
    const cleanup = api.effects[0](); api.run(source, 'en'); cleanup(); await api.flush(); assert.equal(api.requests.length, 0);
    const failed = await fixture('translation', [source]); failed.port.generateNodeRef.current = async () => { throw Error('提交失败'); };
    failed.run(source, 'zh'); await failed.flush(); assert.deepEqual(failed.errors, ['提交失败']);
});
test('单卡配置从当前提示词识别尺寸和生成类型，保留质量；只建配置不执行生成', async () => {
    const source = { ...node('source', { content: ' 1152 x 1536 px 3:4 MAIN IMAGE ', quality: 'high' }), title: '主图提示词' };
    const api = await fixture('config', [source]); api.run({ ...source, metadata: { content: '旧值' } });
    const created = api.port.nodesRef.current.find(n => n.type === 'config');
    assert.equal(created.metadata.size, '1152x1536'); assert.equal(created.metadata.generationAspectRatio, '3:4'); assert.equal(created.metadata.quality, 'high');
    assert.equal(created.metadata.generationParamsSourceNodeId, 'source'); assert.equal(created.metadata.model, '图片');
    assert.equal(api.requests.length, 0); assert.equal(api.nodeDialog, created.id); assert.equal(api.selectedConnection, null);
    assert.deepEqual(api.port.nodesRef.current[0].position, source.position); assert.equal(api.port.nodesRef.current[0].metadata.content, source.metadata.content.trim());
});
test('视频提示词单卡创建选视频模型，空/已删除提示词不改画布', async () => {
    const source = { ...node('source', { content: '视频原文' }), title: '视频提示词' }, api = await fixture('config', [source]); api.run(source);
    const config = api.port.nodesRef.current.find(n => n.type === 'config'); assert.equal(config.metadata.generationMode, 'video'); assert.equal(config.metadata.model, '视频');
    const empty = await fixture('config', [node('empty')]); empty.run(node('deleted')); empty.run(node('empty', { content: '过期非空' }));
    assert.deepEqual(empty.order, []); assert.deepEqual(empty.warnings, ['提示词为空']);
});
test('新建单卡配置避让已有卡片，原提示词和障碍位置不改变', async () => {
    const source = node('source', { content: '正文' }), obstacle = { ...node('obstacle'), position: { x: 550, y: 40 }, width: 500, height: 400 };
    const api = await fixture('config', [source, obstacle]); api.run(source);
    const created = api.port.nodesRef.current[2]; assert.equal(placement.nodesOverlap(created, obstacle), false);
    assert.deepEqual(api.port.nodesRef.current[0].position, source.position); assert.equal(api.port.nodesRef.current[1], obstacle);
});

const filenames = await load('媒体交付/生成图片命名.js');
const extensions = await load('生成历史/媒体文件扩展.js');
async function downloads(read) {
    const saved = [], errors = [], calls = [];
    const { useCanvasMediaDownloads } = await load('媒体交付/画布下载操作.ts', {
        react: hooks, '@/types/canvas': types, 'file-saver': { saveAs: (blob, name) => saved.push({ blob, name }) },
        '@/lib/canvas/canvas-generation-helpers': { audioExtension: mime => mime.includes('wav') ? 'wav' : 'mp3' },
        '../画布迁移扩展/media-download': { readDownloadBlob: async request => { calls.push(request); return read(request); } },
        './生成图片命名': filenames, '../生成历史/媒体文件扩展': extensions,
    });
    return { ...useCanvasMediaDownloads({ error: error => errors.push(error) }), saved, errors, calls };
}
test('画布图片下载读持久原文件并沿用编号，扩展名按实际MIME', async () => {
    const original = new Blob(['original'], { type: 'image/jpeg' }); const api = await downloads(() => original);
    const image = node('image', { storageKey: 'image:original', content: 'blob:old', primaryImageId: 'slot', generationNameBase: '主图', images: [{ id: 'slot', generationSequence: 2 }] }, 'image');
    await api.downloadNodeImage(image);
    assert.deepEqual(api.calls, [{ kind: 'image', storageKey: 'image:original', url: 'blob:old' }]);
    assert.equal(api.saved[0].blob, original); assert.equal(api.saved[0].name, filenames.generatedImageName(image, 'slot') + '.jpg');
});
test('批次下载仅选定图片，视频/音频使用各自读取类别及扩展名并清理非法文件名', async () => {
    const api = await downloads(request => new Blob(['data'], { type: request.kind === 'video' ? 'video/webm' : request.kind === 'audio' ? 'audio/wav' : 'image/webp' }));
    const batch = node('batch', { images: [{ id: 'one', storageKey: 'image:one' }, { id: 'two', storageKey: 'image:two' }] }, 'image');
    await api.downloadBatchImage(batch, 'two'); await api.downloadNodeImage({ ...node('v', { storageKey: 'video:v' }, 'video'), title: '视频/示例' });
    await api.downloadNodeImage({ ...node('a', { storageKey: 'audio:a' }, 'audio'), title: '音频:示例' });
    assert.deepEqual(api.calls.map(call => [call.kind, call.storageKey]), [['image', 'image:two'], ['video', 'video:v'], ['audio', 'audio:a']]);
    assert.ok(api.saved[0].name.endsWith('.webp')); assert.equal(api.saved[1].name, '视频_示例.webm'); assert.equal(api.saved[2].name, '音频_示例.wav');
});
test('无文件和不存在的批次槽位不读取；原文件失败不产生伪下载', async () => {
    const api = await downloads(() => { throw Error('原文件缺失'); });
    await api.downloadNodeImage(node('text', { content: '正文' })); await api.downloadNodeImage(node('empty', {}, 'image')); await api.downloadBatchImage(node('batch'), 'missing');
    assert.equal(api.calls.length, 0); await api.downloadNodeImage(node('broken', { storageKey: 'image:missing' }, 'image'));
    assert.deepEqual(api.errors, ['原文件缺失']); assert.deepEqual(api.saved, []);
});

const themes = await load('Excel画布/旧版主题翻译.js');
const variableRules = await load('提示词/变量使用规则.ts');
const rules = await load('Excel画布/旧版参数规则.ts', { './旧版主题翻译.js': themes, '../提示词/变量使用规则': variableRules });
test('参数卡移除AI入口和请求依赖后，填写仍同步原卡和关联预览，空变量保留', async () => {
    const parameter = node('parameter', { promptVariableValues: { '[NAME]': '产品' }, promptVariableTokens: ['[NAME]', '[LENGTH]'], promptVariableSourceNodeId: 'source' }, 'guan:prompt-variables');
    const source = node('source', { content: '[NAME] [LENGTH]', excelPromptBindingNodeId: parameter.id });
    const preview = node('preview', { promptVariablePreviewOf: parameter.id, promptVariableSourceNodeId: source.id });
    const nodes = [parameter, source, preview], remembered = [], applied = [];
    const ctx = { node: parameter, getNode: id => nodes.find(n => n.id === id), getNodes: () => nodes, getConnections: () => [], applyOps: ops => applied.push(ops), updateMetadata: () => assert.fail('应同笔更新关联节点') };
    const jsx = (type, props) => ({ type, props });
    const titles = await load('Excel画布/旧版最终提示词标题.ts');
    const linked = await load('Excel画布/产品参数联动.ts', { '../提示词/变量使用规则': variableRules, './旧版最终提示词标题': titles });
    const editing = await load('Excel画布/产品参数编辑操作.ts', {
        react: { useCallback: callback => callback }, './产品参数联动': linked,
        './Excel参数记忆': { saveProductParameterValues: (...args) => remembered.push(args) },
    });
    const { PromptVariablesContent } = await load('Excel画布/旧版参数卡片.tsx', {
        react: { useMemo: compute => compute(), useEffect: () => {}, useRef: current => ({ current }) }, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { Braces: 'icon' },
        '@/lib/canvas-theme': { canvasThemes: { light: { node: {}, toolbar: {} } } }, '@/stores/use-theme-store': { useThemeStore: selector => selector({ theme: 'light' }) },
        './产品参数编辑操作': editing, './旧版参数规则': rules, './Excel画布上下文': { useExcelProductId: () => 'a', useExcelPromptContext: () => ({ templates: [], fileName: '测试.xlsx' }) },
        './Excel参数记忆': { readProductParameterValues: () => ({}), saveProductParameterValues: (...args) => remembered.push(args) },
    });
    const result = PromptVariablesContent({ ctx }), elements = [];
    function visit(value) { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) return value.forEach(visit); elements.push(value); visit(value.props?.children); }
    visit(result); assert.equal(elements.some(el => el.type === 'button'), false);
    const input = elements.find(el => el.type === 'input' && el.props.placeholder === '[NAME]'); input.props.onChange({ target: { value: '真实产品' } });
    assert.deepEqual(remembered, [['a', { '[NAME]': '真实产品' }]]); assert.equal(applied.length, 1);
    assert.match(applied[0].find(op => op.id === 'preview').metadata.content, /^真实产品 （本画面不使用产品尺寸参数）/);
    assert.match(applied[0].find(op => op.id === 'source').metadata.excelPromptResolved, /未填写变量：\[LENGTH\]/);
});
