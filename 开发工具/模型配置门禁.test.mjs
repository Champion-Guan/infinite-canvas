import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';

const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json')), ts = require('typescript');
const types = ['text', 'image', 'video', 'audio'];
function load(path, dependencies) {
    const result = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputText)(id => {
        assert.ok(Object.hasOwn(dependencies, id), '未声明依赖：' + id);
        return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
function fixture() {
    const notices = load('扩展功能/产品配置/模型配置通知.ts', {});
    const calls = [], changes = [];
    const state = {
        config: { channels: [] }, isConfigOpen: false, configTab: 'preferences',
        isAiConfigReady(config, model) {
            const [id, name] = model.includes('::') ? model.split('::') : ['', model];
            const channel = config.channels.find(channel => (!id || channel.id === id) && channel.models.some(item => item.name === name));
            return Boolean(channel?.apiKey && channel.baseUrl && !channel.apiKey.startsWith('sealed:'));
        },
        openConfigDialog(continueRequest, tab) { calls.push({ continueRequest, tab }); this.isConfigOpen = true; this.configTab = tab; },
    };
    const capabilityOf = (config, model) => {
        const [id, name] = model?.includes('::') ? model.split('::') : ['', model];
        return config.channels.find(channel => (!id || channel.id === id) && channel.models.some(item => item.name === name))
            ?.models.find(item => item.name === name)?.capability;
    };
    let fallback = [];
    const store = { useConfigStore: { getState: () => state }, modelCapabilityOf: capabilityOf,
        FALLBACK_MODEL_OPTION: '__fallback__', fallbackModelsByCapability: (_config, capability) => {
            changes.push(capability); return fallback;
        } };
    const gate = load('扩展功能/产品配置/模型配置门禁.ts', {
        '@/stores/use-config-store': store, './模型配置通知': notices,
    });
    const configured = capability => ({ model: 'channel::model', channels: [{
        id: 'channel', baseUrl: 'https://synthetic.invalid', apiKey: 'synthetic-local-only', models: [{ name: 'model', capability }],
    }] });
    return { state, calls, gate, notices, store, configured, fallbackChanges: changes, setFallback: values => { fallback = values; } };
}

for (const capability of types) {
    test(`缺少${capability}模型时阻止操作、打开渠道并发布具体提示；配置完成后放行`, () => {
        const f = fixture(), labels = { text: '文本', image: '图片', video: '视频', audio: '音频' };
        const config = { model: 'old::removed', channels: [] };
        assert.equal(f.gate.ensureModelConfigured(config, capability), false);
        assert.deepEqual(f.calls, [{ continueRequest: false, tab: 'channels' }]);
        assert.match(f.notices.missingModelNoticeSnapshot().message, new RegExp(labels[capability]));
        assert.equal(f.state.configTab, 'channels');
        assert.equal(f.gate.ensureModelConfigured(f.configured(capability), capability), true);
        assert.equal(f.calls.length, 1, '成功不打开设置或增加提示');
    });
}
test('错误能力、已删除模型、地址或密钥缺失均拒绝；不在提示中暴露凭据', () => {
    for (const scenario of ['wrong-capability', 'removed', 'empty-address', 'empty-key', 'sealed']) {
        const f = fixture(), config = f.configured('text');
        if (scenario === 'wrong-capability') config.channels[0].models[0].capability = 'image';
        if (scenario === 'removed') config.model = 'channel::missing';
        if (scenario === 'empty-address') config.channels[0].baseUrl = '';
        if (scenario === 'empty-key') config.channels[0].apiKey = '';
        if (scenario === 'sealed') config.channels[0].apiKey = 'sealed:not-loaded';
        assert.throws(() => f.gate.requireModelConfigured(config, 'text'), error =>
            error.code === 'model_configuration_required' && error.capability === 'text');
        const text = f.notices.missingModelNoticeSnapshot().message;
        assert.doesNotMatch(text, /synthetic|sealed:|https:/);
    }
});
test('Fallback按请求能力检查，有可用候选才放行，不借用其他能力或不可用渠道', () => {
    const f = fixture(), config = f.configured('audio');
    config.model = '__fallback__'; f.setFallback(['channel::model']);
    assert.equal(f.gate.ensureModelConfigured(config, 'audio'), true);
    assert.deepEqual(f.fallbackChanges, ['audio']);
    assert.equal(f.gate.ensureModelConfigured(config, 'video'), false);
    assert.deepEqual(f.fallbackChanges, ['audio', 'video']);
    config.channels[0].apiKey = '';
    assert.equal(f.gate.ensureModelConfigured(config, 'audio'), false);
});
test('通知不常驻且相同并发提示合并；关闭设置后再次触发仍打开渠道', () => {
    const f = fixture(), config = { channels: [], model: '' }; let updates = 0;
    const unsubscribe = f.notices.subscribeMissingModelNotice(() => updates++);
    f.gate.ensureModelConfigured(config, 'text'); f.gate.ensureModelConfigured(config, 'text');
    assert.equal(updates, 1);
    f.state.isConfigOpen = false; f.state.configTab = 'preferences';
    f.gate.ensureModelConfigured(config, 'text');
    assert.equal(f.state.isConfigOpen, true); assert.equal(f.state.configTab, 'channels');
    f.gate.ensureModelConfigured(config, 'image'); assert.equal(updates, 2);
    unsubscribe();
    const effects = [], cells = [], messages = []; let cursor = 0;
    const noticeView = load('扩展功能/存储界面/模型配置提示.tsx', {
        react: { useEffect: callback => effects.push(callback), useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
            useRef(value) { const i = cursor++; return cells[i] ||= { current: value }; } },
        antd: { App: { useApp: () => ({ message: { warning: value => messages.push(value) } }) } },
        '../产品配置/模型配置通知': f.notices,
    });
    const render = () => { cursor = 0; noticeView.MissingModelConfigurationNotice(); while (effects.length) effects.shift()(); };
    render(); assert.equal(messages.length, 0, '挂载不重播旧提示');
    f.gate.ensureModelConfigured(config, 'audio'); render(); render();
    assert.equal(messages.length, 1); assert.equal(messages[0].duration, 4);
    assert.equal(messages[0].key, 'missing-model-configuration');
});
test('缺少文本模型时翻译不建卡、不连线、不提交请求', () => {
    const f = fixture(), product = variantFixture(), calls = [];
    const loader = variantModules({
        react: { useCallback: value => value, useRef: value => ({ current: value }), useEffect() {} },
        '../产品配置/模型配置门禁': f.gate,
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: () => ({ model: '', channels: [] }) },
    });
    const api = loader.load('画布生成/提示词翻译操作.ts').usePromptTranslation({
        projectId: 'product', nodesRef: { current: product.nodes }, connectionsRef: { current: product.connections },
        generateNodeRef: { current: async () => calls.push('request') }, effectiveConfig: {},
        assertImportTarget() {}, setNodes: () => calls.push('nodes'), setConnections: () => calls.push('edges'),
        setSelectedNodeIds() {}, message: { warning() {} },
    });
    api(product.text, 'en');
    assert.deepEqual(calls, []);
    assert.equal(f.calls[0].tab, 'channels');
});
test('混合批量任一能力缺失时整批不启动，补齐并执行也不先创建配置卡片', async () => {
    const f = fixture(), events = [], product = variantFixture();
    const loader = variantModules({
        '../产品配置/模型配置门禁': f.gate,
        '@/lib/canvas/canvas-generation-helpers': { getGenerationCount: () => 1, buildGenerationConfig: (_config, _node, mode) => f.configured(mode === 'image' ? 'image' : 'text') },
    });
    const video = { ...product.config, id: 'video', metadata: { generationMode: 'video', prompt: '视频提示词' } };
    const nodesRef = { current: [...product.nodes, video] };
    const api = loader.load('画布生成/批量生成操作.ts').useCanvasBatchGeneration({
        projectId: 'product', nodesRef, connectionsRef: { current: product.connections }, effectiveConfig: {},
        setNodes: () => events.push('nodes'), setConnections: () => events.push('edges'), setSelectedNodeIds() {},
        setSelectedConnectionId() {}, handleGenerateNode: async () => events.push('request'),
        message: { info: value => events.push(value), error: value => events.push(value) },
    });
    await api.generateAllConfigNodes(); assert.deepEqual(events, []);
    await api.completeAndGenerateAll(); assert.deepEqual(events, []);
    assert.match(f.notices.missingModelNoticeSnapshot().message, /视频/);
});
test('本机文本、图片和音频新请求在准备前拦截，不绑定渠道、不记录任务、不请求网络', async () => {
    for (const capability of ['text', 'image', 'audio']) {
        const f = fixture(), events = [], name = { text: '原画布文本调用.ts', image: '原画布图片调用.ts', audio: '原画布音频调用.ts' }[capability];
        const loader = variantModules({
            '../产品配置/模型配置门禁': f.gate,
            '@/stores/use-config-store': { resolveModelRequestConfig: () => { events.push('resolve'); return {}; } },
            './原画布图片调用': { bindGenerationChannel: async () => events.push('bind') },
            '../故障切换/图片路由请求': { prepareRoutedImageRequest: async () => events.push('image'), parseRoutedImageResponse() {} },
            '../生成网关/渠道绑定客户端': { bindConfiguredChannel: async () => events.push('bind') },
            './图片任务衔接.mjs': { runCanvasImageTask: async options => { await options.prepare(); events.push('submit'); } },
            './文本生成协议': { prepareTextRequest: () => events.push('text'), parseTextResponse() {} },
            './文本临时显示.mjs': { publishTextPreview() {}, clearTextPreview() {} },
            '@/lib/audio-generation': {}, '../产品配置/精简与离线策略': { requireGenerationMode() {} },
        });
        const module = loader.load('画布生成/' + name);
        globalThis.window = { __guanGenerationHost: {} };
        try {
            const request = module[{ text: 'requestCanvasText', image: 'requestCanvasImage', audio: 'requestCanvasAudio' }[capability]];
            await assert.rejects(request({ config: { channels: [], model: '' }, prompt: '正文', messages: [],
                scope: { productId: 'product', nodeId: 'node', slotId: 'slot' }, recordTask: async () => events.push('record'),
                applyAndSave: async () => events.push('save') }), error => error.code === 'model_configuration_required');
            assert.deepEqual(events, []); assert.equal(f.calls[0].tab, 'channels');
        } finally { delete globalThis.window; }
    }
});
