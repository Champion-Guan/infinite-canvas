import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { variantFixture, variantModules } from './产品变体生成夹具.mjs';
import { generationFixture } from './生成网关隔离夹具.mjs';
import { runCanvasImageTask } from '../扩展功能/画布生成/图片任务衔接.mjs';
import { recoverGenerationResponse } from '../扩展功能/生成任务/本机任务响应恢复.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const rules = variantModules().load('画布生成/文本推理强度.ts');
const protocol = variantModules().load('画布生成/文本生成协议.ts');
const efforts = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
const channel = (id, supported) => ({ id, name: id, baseUrl: 'https://synthetic.invalid', apiKey: 'synthetic-only', apiFormat: 'openai',
    models: [{ name: 'same-model', capability: 'text', ...(supported ? { reasoningEfforts: supported } : {}) }] });
const config = (effort = 'medium') => ({
    model: 'a::same-model', textModel: 'a::same-model', imageModel: 'image', systemPrompt: '', apiFormat: 'openai',
    baseUrl: 'https://synthetic.invalid', reasoningEffort: effort, channels: [channel('a', efforts), channel('b')],
});

test('六档顺序固定、默认中，旧自动及缺省按中读取，不改变有效档位', () => {
    assert.deepEqual([...rules.TEXT_REASONING_EFFORTS], efforts);
    for (const old of ['auto', 'ultra', undefined, null, '', 'wrong']) assert.equal(rules.normalizeTextReasoningEffort(old), 'medium');
    for (const effort of efforts) assert.equal(rules.normalizeTextReasoningEffort(effort), effort);
    assert.deepEqual(rules.normalizeModelReasoningEfforts(['ultra', 'medium', 'none', 'wrong']), ['none', 'medium']);
    assert.throws(() => rules.requireTextReasoningEffort('ultra', efforts), /已移除/);
});

test('None和Max按具体渠道模型启用，不按名称猜，不跨同名渠道借用能力', () => {
    const cfg = config('max'), before = structuredClone(cfg);
    assert.deepEqual([...rules.modelTextReasoningEfforts(cfg, 'a::same-model')], efforts);
    assert.deepEqual([...rules.modelTextReasoningEfforts(cfg, 'b::same-model')], ['low', 'medium', 'high', 'xhigh']);
    for (const value of ['none', 'max'])
        assert.throws(() => rules.requireTextReasoningEffort(value, rules.modelTextReasoningEfforts(cfg, 'b::same-model')), /未声明支持/);
    cfg.channels[1].models[0].reasoningEfforts = ['medium', 'max'];
    assert.equal(rules.requireTextReasoningEffort('max', rules.modelTextReasoningEfforts(cfg, 'b::same-model')), 'max');
    assert.throws(() => rules.requireTextReasoningEffort('none', rules.modelTextReasoningEfforts(cfg, 'b::same-model')), /未声明支持/);
    assert.deepEqual(before.channels[0], cfg.channels[0]);
});

test('严格按完整模型ID设置截图档位，6.1Sol和6Astra隐藏None且不可被渠道配置开启', () => {
    const cfg = name => ({ model: `a::${name}`, channels: [{ id: 'a', models: [{ name }] }] });
    for (const name of ['gpt-6.1-sol', 'gpt-6-astra']) {
        assert.deepEqual([...rules.modelTextReasoningEfforts(cfg(name))], efforts.slice(1));
        const declared = cfg(name); declared.channels[0].models[0].reasoningEfforts = efforts;
        assert.deepEqual([...rules.modelTextReasoningEfforts(declared)], efforts.slice(1));
        assert.equal(rules.modelAllowsTextReasoningEffort(name, 'none'), false);
        assert.deepEqual([...rules.modelTextReasoningEffortOptions(`a::${name}`)], efforts.slice(1));
        assert.throws(() => rules.requireTextReasoningEffort('none', rules.modelTextReasoningEfforts(declared)), /未声明支持/);
    }
    for (const name of ['gpt-6.1-terra', 'gpt-6-luna']) assert.deepEqual([...rules.modelTextReasoningEfforts(cfg(name))], efforts);
    for (const name of ['gpt-6-sol', 'gpt-6.1-sol-custom', 'gpt-6.1-sol-2026-11-12', 'provider/gpt-6.1-sol', 'gpt-6-astra-lite'])
        assert.deepEqual([...rules.modelTextReasoningEfforts(cfg(name))], ['low', 'medium', 'high', 'xhigh']);
    const limited = cfg('gpt-6.1-sol'); limited.channels[0].models[0].reasoningEfforts = ['medium', 'high'];
    assert.deepEqual([...rules.modelTextReasoningEfforts(limited)], ['medium', 'high']);
});

test('Responses实际正文始终显式传递强度，未知扩展档在编码前拒绝', () => {
    for (const value of [...efforts, 'auto', undefined]) {
        const input = { ...config(value), reasoningEffort: value, model: 'same-model', modelReasoningEfforts: efforts };
        const wire = protocol.prepareTextRequest(input, [{ role: 'user', content: '合成检查' }]);
        const body = JSON.parse(Buffer.from(wire.body, 'base64'));
        assert.equal(wire.path, '/v1/responses');
        assert.equal(body.reasoning.effort, value === 'auto' || value === undefined ? 'medium' : value);
        assert.equal(body.stream, true);
    }
    for (const value of ['none', 'max']) assert.throws(() => protocol.prepareTextRequest({
        ...config(value), model: 'same-model',
    }, [{ role: 'user', content: '不能发出' }]), /未声明支持/);
});

test('真实文本任务入口在绑定、登记与提交前拒绝不支持的档位', async () => {
    const previousWindow = globalThis.window, calls = [];
    const host = Object.fromEntries(['submit', 'get', 'deliver', 'checkpoint'].map(name => [name, async () => calls.push(name)]));
    globalThis.window = { __guanGenerationHost: host };
    try {
        for (const effort of ['none', 'max']) {
            const cfg = { ...config(effort), model: 'b::same-model' };
            const loader = variantModules({
                '@/stores/use-config-store': { useConfigStore: { getState: () => ({ isAiConfigReady: () => true }) },
                    resolveModelRequestConfig: value => ({ ...value, model: 'same-model', modelReasoningEfforts: rules.modelTextReasoningEfforts(value) }) },
                './原画布图片调用': { bindGenerationChannel: async () => calls.push('bind') },
                './图片任务衔接.mjs': { runCanvasImageTask },
                '../生成任务/本机任务响应恢复.mjs': { recoverGenerationResponse },
            });
            const { requestCanvasText } = loader.load('画布生成/原画布文本调用.ts');
            await assert.rejects(requestCanvasText({ config: cfg, messages: [{ role: 'user', content: '不能发出' }],
                scope: { productId: 'synthetic', nodeId: 'synthetic', slotId: 'text' },
                recordTask: async () => calls.push('record'), applyAndSave: async () => calls.push('apply'),
            }), /未声明支持/);
        }
        assert.deepEqual(calls, []);
    } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});

function loadStore(saved) {
    const writes = [];
    const loader = variantModules({
        react: { useMemo: fn => fn() },
        zustand: require('zustand'),
        'zustand/middleware': require('zustand/middleware'),
        '@/扩展功能/本机凭据/页面凭据引用.mjs': { isSealedCredential: () => false },
        '@/扩展功能/网络代理/本地转发请求': { 本地转发前缀: () => '/local-proxy' },
        '@/扩展功能/本机存储/上游浏览器存储桥': { sqliteStateStorage: {
            getItem: () => saved ? JSON.stringify(saved) : null, removeItem() {},
        }, scheduleStateSave: (_key, value) => writes.push(JSON.parse(value)), flushSQLiteStorage: async () => {} },
        '@/扩展功能/产品配置/精简与离线策略': { requireAuxiliaryFeature() {} },
        '@/扩展功能/产品配置/脚本与提示词来源': { requireBusinessFeature() {} },
        '@/扩展功能/产品配置/功能开关': { productFeatures: {}, requireProductFeature() {} },
        '@/扩展功能/故障切换/浏览器状态': { FALLBACK_MODEL_OPTION: 'fallback', fallbackModelsByCapability: () => [], resolveFallbackModel: () => null },
    });
    const api = loader.load('stores/use-config-store.ts', true);
    return { ...api, writes };
}

test('真实配置Store默认中，旧自动冷读迁移，新档与模型能力保存重开保持', () => {
    const fresh = loadStore();
    assert.equal(fresh.defaultConfig.reasoningEffort, 'medium');
    assert.equal(fresh.useConfigStore.getState().config.reasoningEffort, 'medium');
    const saved = { state: { config: { ...config('auto'), channels: config().channels }, webdav: {} }, version: 0 };
    const old = structuredClone(saved), store = loadStore(saved);
    assert.equal(store.useConfigStore.getState().config.reasoningEffort, 'medium');
    assert.deepEqual(saved, old);
    for (const effort of efforts) {
        store.useConfigStore.getState().updateConfig('reasoningEffort', effort);
        const reread = loadStore(store.writes.at(-1));
        assert.equal(reread.useConfigStore.getState().config.reasoningEffort, effort);
        assert.deepEqual(reread.useConfigStore.getState().config.channels[0].models[0].reasoningEfforts, efforts);
    }
    assert.equal(store.resolveModelRequestConfig(store.useConfigStore.getState().config, 'b::same-model').modelReasoningEfforts.includes('none'), false);
    const legacyUltra = loadStore({ ...saved, state: { ...saved.state, config: { ...saved.state.config, reasoningEffort: 'ultra',
        channels: [{ ...saved.state.config.channels[0], models: [{ name: 'same-model', capability: 'text', reasoningEfforts: ['medium', 'max', 'ultra'] }] }] } } });
    assert.equal(legacyUltra.useConfigStore.getState().config.reasoningEffort, 'medium');
    assert.deepEqual(legacyUltra.useConfigStore.getState().config.channels[0].models[0].reasoningEfforts, ['medium', 'max']);
});

test('AI写提示词使用全局默认文本强度，实际配置解析到正文不丢六档参数', async () => {
    const source = loadStore();
    for (const effort of [...efforts, 'auto']) {
        const f = variantFixture(), cfg = { ...source.defaultConfig, ...config(effort) }, stop = Error('合成请求边界');
        const storeApi = { ...source, useConfigStore: { getState: () => ({ config: cfg, isAiConfigReady: () => true }) } };
        const loader = variantModules({
            '@/stores/use-config-store': storeApi,
            '@/services/image-storage': { imageToDataUrl: async () => 'data:image/png;base64,aXNvbGF0ZWQ=' },
            './商品策划完成通知': { notifyProductPlanning() {} },
            '../产品/产品操作': { saveProductCanvas: async () => ({ persisted: true }) },
            '../画布生成/原画布文本调用': { requestCanvasText: async options => {
                const resolved = source.resolveModelRequestConfig(options.config, options.config.model);
                const wire = protocol.prepareTextRequest(resolved, options.messages);
                assert.equal(JSON.parse(Buffer.from(wire.body, 'base64')).reasoning.effort, effort === 'auto' ? 'medium' : effort);
                assert.equal(resolved.model, 'same-model');
                throw stop;
            } },
            '@/lib/image-utils': {},
            '@/services/file-storage': {},
        });
        loader.dependencies['@/lib/canvas/canvas-generation-helpers'] = loader.load('lib/canvas/canvas-generation-helpers.ts', true);
        const ctx = { node: f.parameter, getNode: id => f.nodes.find(n => n.id === id), getNodes: () => f.nodes, getConnections: () => f.connections,
            updateMetadata: patch => { f.parameter.metadata = { ...f.parameter.metadata, ...patch }; } };
        await assert.rejects(loader.load('Excel画布/商品策划请求.ts').planProductImages(ctx, 'product', new AbortController().signal), error => error === stop);
    }
});

test('真实本机HTTP渠道接收全部已声明档位，仅每档一个合成请求', async () => {
    const f = await generationFixture({ respond: async (_request, response) => {
        const text = '合成正文';
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output_text: text } }) + '\n\n');
    } });
    try {
        const binding = await f.bind();
        for (const effort of efforts) {
            const wire = protocol.prepareTextRequest({ ...config(effort), model: 'synthetic', modelReasoningEfforts: efforts }, [{ role: 'user', content: '合成验证' }]);
            const input = f.submit(binding.binding, { request: wire });
            await f.tasks.submit(input); await f.tasks.drain();
            assert.equal(f.tasks.get(input.id).state, 'succeeded');
            assert.equal(JSON.parse(f.requests.at(-1).bytes).reasoning.effort, effort);
        }
        assert.equal(f.requests.length, 6);
    } finally { await f.close(); }
});

const jsx = (type, props) => ({ type, props: props || {} });
const flatten = node => Array.isArray(node) ? node.flatMap(flatten) : !node || typeof node !== 'object' ? [] :
    typeof node.type === 'function' ? flatten(node.type(node.props)) : [node, ...flatten(node.props.children)];
test('真实文本设置六档不含自动，默认中选中，未知模型的扩展档禁用', () => {
    const labels = { none: '无推理', low: '轻度', medium: '中', high: '高', xhigh: '极高', max: 'Max' };
    const translate = key => labels[key.split('.').at(-1)] || key;
    const changes = [], loader = variantModules({
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-i18next': { useTranslation: () => ({ t: translate }) },
        '@/i18n': { default: { t: translate } }, '@/components/image-settings-panel': { ImageSettingsTheme: 'Theme' },
    });
    const panel = loader.load('components/text-settings-panel.tsx', true);
    const tree = flatten(panel.TextSettingsPanel({ config: { ...config('auto'), model: 'b::same-model' }, onConfigChange: (...args) => changes.push(args), theme: { node: {} } }));
    const buttons = tree.filter(node => node.type === 'button');
    assert.deepEqual(buttons.map(node => node.props.children), ['无推理', '轻度', '中', '高', '极高', 'Max']);
    assert.deepEqual(buttons.map(node => node.props['aria-pressed']), [false, false, true, false, false, false]);
    assert.deepEqual(buttons.map(node => Boolean(node.props.disabled)), [true, false, false, false, false, true]);
    buttons[3].props.onClick();
    assert.deepEqual(changes, [['reasoningEffort', 'high']]);
    assert.equal(panel.reasoningEffortLabel('auto'), '中');
    for (const name of ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-luna']) {
        const known = flatten(panel.TextSettingsPanel({ config: { ...config(), model: `a::${name}` }, onConfigChange() {}, theme: { node: {} } }));
        const knownLabels = known.filter(node => node.type === 'button').map(node => node.props.children);
        assert.deepEqual(knownLabels, ['gpt-6.1-sol', 'gpt-6-astra'].includes(name)
            ? ['轻度', '中', '高', '极高', 'Max'] : ['无推理', '轻度', '中', '高', '极高', 'Max']);
        const card = flatten(panel.TextSettingsPanel({ config: { ...config(), model: `a::${name}` }, showUnsupportedNone: true,
            onConfigChange() {}, theme: { node: {} } })).filter(node => node.type === 'button');
        assert.deepEqual(card.map(node => node.props.children), ['无推理', '轻度', '中', '高', '极高', 'Max']);
        assert.equal(Boolean(card[0].props.disabled), ['gpt-6.1-sol', 'gpt-6-astra'].includes(name));
    }
});

test('文本卡和生成配置卡独立设置都保留无推理，实际浮层透传且不修改模型能力', () => {
    const loader = variantModules({
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
        '@/扩展功能/主题/原生设置浮层': { NativeSettingsPopover: 'Popover' },
        'lucide-react': { Settings2: 'Settings2' }, antd: { Button: 'Button', InputNumber: 'InputNumber' },
        '@/components/text-settings-panel': { reasoningEffortLabel: effort => effort, TextSettingsPanel: 'Panel' },
        '@/lib/canvas-theme': { canvasThemes: { light: { node: {} } } },
        '@/stores/use-theme-store': { useThemeStore: fn => fn({ theme: 'light' }) },
    });
    const { CanvasTextSettingsPopover } = loader.load('components/canvas/canvas-text-settings-popover.tsx', true);
    for (const enabled of [false, true]) {
        const tree = CanvasTextSettingsPopover({ config: config(), onConfigChange() {}, showUnsupportedNone: enabled });
        const panel = flatten(tree.props.content).find(node => node.type === 'Panel');
        assert.equal(panel.props.showUnsupportedNone, enabled);
    }
    const source = file => readFileSync(new URL('../.运行/3100源/画布副本/web/src/' + file, import.meta.url), 'utf8');
    assert.match(source('components/canvas/canvas-node-prompt-panel.tsx'), /<CanvasTextSettingsPopover showUnsupportedNone /);
    assert.match(source('components/canvas/canvas-config-node-panel.tsx'), /<CanvasTextSettingsPopover showUnsupportedNone /);
});

test('模型二级菜单按悬停展开，六档按对应模型禁用，选择同时提交模型与强度', () => {
    const labels = { none: '无推理', low: '轻度', medium: '中', high: '高', xhigh: '极高', max: 'Max' };
    const loader = variantModules({
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { Check: 'Check', ChevronDown: 'ChevronDown' },
        '../主题/原生可关闭浮层': { OutsideDropdown: 'Dropdown' },
        '../主题/苹果下拉菜单.module.css': { default: { dropdown: 'dropdown', submenu: 'submenu' } },
        '@/components/text-settings-panel': { reasoningEffortLabel: value => labels[value] },
    });
    const changes = [], opened = [];
    const { TextModelReasoningMenu } = loader.load('画布生成/文本模型推理菜单.tsx');
    const tree = TextModelReasoningMenu({ config: config('medium'), options: ['a::same-model', 'b::same-model'], value: 'a::same-model',
        open: true, onOpenChange: value => opened.push(value), onSelect: (...args) => changes.push(args), renderModel: model => model, placeholder: '选择模型' });
    const menu = tree.props.menu;
    assert.equal(menu.triggerSubMenuAction, 'hover');
    assert.deepEqual(menu.items[0].children.map(item => item.label.props.children[0].props.children), ['无推理', '轻度', '中', '高', '极高', 'Max']);
    assert.deepEqual(menu.items[0].popupOffset, [12, -7]);
    assert.equal(menu.style.height, undefined);
    assert.equal(menu.items[0].popupStyle.height, undefined);
    assert.equal(menu.style.maxHeight, 'calc(100vh - 24px)');
    assert.equal(menu.style.overflowY, 'auto');
    assert.equal(menu.items[0].children[2].label.props.children[1].type, 'Check');
    assert.ok(menu.items[0].children.every(item => !Object.hasOwn(item, 'icon')));
    assert.equal(menu.items[0].children.every(item => !item.disabled), true);
    assert.deepEqual(menu.items[1].children.map(item => item.disabled), [true, false, false, false, false, true]);
    menu.onClick({ key: '1-none' });
    assert.deepEqual(changes, []); assert.deepEqual(opened, []);
    menu.onClick({ key: '0-max' });
    assert.deepEqual(changes, [['a::same-model', 'max']]); assert.deepEqual(opened, [false]);
    for (const model of ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-luna']) {
        const knownChanges = [];
        const known = TextModelReasoningMenu({ config: { reasoningEffort: 'medium' }, options: [model], value: model,
            open: true, onOpenChange() {}, onSelect: (...args) => knownChanges.push(args), renderModel: model => model, placeholder: '选择模型' }).props.menu;
        const noneHidden = ['gpt-6.1-sol', 'gpt-6-astra'].includes(model);
        assert.deepEqual(known.items[0].children.map(item => item.label.props.children[0].props.children),
            noneHidden ? ['轻度', '中', '高', '极高', 'Max'] : ['无推理', '轻度', '中', '高', '极高', 'Max']);
        assert.equal(known.items[0].children.at(-1).disabled, false);
        known.onClick({ key: '0-none' });
        assert.deepEqual(knownChanges, noneHidden ? [] : [[model, 'none']]);
    }
});

test('文本选择器仅在接入回调时使用二级菜单，文本卡保持原模型框', () => {
    const loader = variantModules({
        react: { useEffect() {}, useId: () => 'picker', useRef: current => ({ current }), useState: value => [value, () => {}] },
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
        'lucide-react': { Cpu: 'Cpu', Repeat2: 'Repeat2' },
        '@/扩展功能/故障切换/浏览器状态': { useFallbackRevision() {} },
        '@/扩展功能/产品配置/模型配置门禁': { showMissingModelConfiguration() {} },
        '@/扩展功能/画布生成/文本模型推理菜单': { TextModelReasoningMenu: 'ReasoningMenu' },
        '@/components/ui/select': { Select: 'Select', SelectContent: 'Content', SelectItem: 'Item', SelectTrigger: 'Trigger' },
        '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
        '@/stores/use-config-store': { FALLBACK_MODEL_OPTION: 'fallback', hasEnabledFallback: () => false,
            modelOptionLabel: (_config, value) => value, modelOptionName: value => value,
            selectableModelsByCapability: () => ['a::same-model'] },
    });
    const { ModelPicker } = loader.load('components/model-picker.tsx', true);
    const args = { config: config(), value: 'a::same-model', capability: 'text', onChange() {} };
    assert.equal(ModelPicker({ ...args, onReasoningEffortChange() {} }).type, 'ReasoningMenu');
    assert.equal(ModelPicker(args).type, 'Select');
    assert.equal(ModelPicker({ ...args, capability: 'image', onReasoningEffortChange() {} }).type, 'Select');
    const source = name => readFileSync(new URL('../.运行/3100源/画布副本/web/src/' + name, import.meta.url), 'utf8');
    assert.doesNotMatch(source('components/layout/app-config-modal.tsx'), /label="默认文本推理强度"/);
    assert.match(source('components/layout/app-config-modal.tsx'), /onReasoningEffortChange=/);
    assert.match(source('components/canvas/canvas-config-node-panel.tsx'), /onReasoningEffortChange=/);
    assert.doesNotMatch(source('components/canvas/canvas-node-prompt-panel.tsx'), /onReasoningEffortChange=/);
});
