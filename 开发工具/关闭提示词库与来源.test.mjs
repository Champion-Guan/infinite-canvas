import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { variantModules } from './产品变体生成夹具.mjs';

const web = resolve(import.meta.dirname, '../.运行/3100源/画布副本/web');
const ts = createRequire(resolve(web, 'package.json'))('typescript');
const policy = variantModules().load('产品配置/脚本与提示词来源.ts');
const denied = { code: 'product_feature_disabled' };
const jsx = (type, props) => ({ type, props });
const elements = node => Array.isArray(node) ? node.flatMap(elements)
    : node && typeof node === 'object' ? [node, ...elements(node.props?.children)] : [];
const react = {
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useRef: current => ({ current }), useEffect() {}, memo: value => value,
};
const theme = { toolbar: {}, node: {} };

// 只执行被测父组件，子组件保持为元素，避免挂载真实数据和网络依赖。
function renderModule(file, overrides = {}) {
    const deps = {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx },
        'react-i18next': { useTranslation: () => ({ t: key => key, i18n: { resolvedLanguage: 'zh' } }) },
        'motion/react': { useReducedMotion: () => true, motion: { div: 'motion.div', aside: 'motion.aside' } },
        '@/扩展功能/产品配置/脚本与提示词来源': policy,
        '@/扩展功能/产品/产品界面边界': { useProductActive: () => true },
        '@/lib/canvas-theme': { canvasThemes: { light: theme } },
        '@/stores/use-theme-store': { useThemeStore: selector => selector({ theme: 'light' }) },
        '@/types/canvas': { CanvasNodeType: { Image: 'image', Text: 'text', Config: 'config', Audio: 'audio', Video: 'video', Group: 'group' } },
        ...overrides,
    };
    const source = readFileSync(resolve(web, 'src', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => deps[id] ?? new Proxy({}, {
        get: (_, key) => `${id}:${String(key)}`,
    }), module, module.exports);
    return module.exports;
}

test('提示词库和来源恢复开放，来源设置页签可用，模型脚本保持关闭', () => {
    assert.equal(policy.businessFeatures.promptLibrary, true);
    assert.equal(policy.businessFeatures.promptSources, true);
    assert.equal(policy.resolveBusinessConfigTab('prompt-sources'), 'prompt-sources');
    for (const key of ['channels', 'preferences', 'local-storage', 'software-updates'])
        assert.equal(policy.resolveBusinessConfigTab(key), key);
    for (const key of ['promptLibrary', 'promptSources', 'promptRefresh', 'promptSourceCreate', 'promptRefreshAll'])
        assert.doesNotThrow(() => policy.requireBusinessFeature(key));
    assert.throws(() => policy.requireBusinessFeature('modelScripts'), denied);
});

test('列表、单来源、统计和各类刷新均在读取缓存、配置及请求之前拒绝', async () => {
    const hit = () => assert.fail('关闭后不应访问来源、缓存或网络');
    const api = variantModules({
        '@/扩展功能/产品配置/脚本与提示词来源': { requireBusinessFeature() { throw Object.assign(Error('关闭'), denied); } },
        '@/扩展功能/本机存储/上游浏览器存储桥': { sqliteForage: { createInstance: () => ({ getItem: hit, setItem: hit }) } },
        './prompt-source-runtime': { runPromptSource: hit },
        '@/stores/use-prompt-source-store': { usePromptSourceStore: { getState: hit } },
    }).load('services/api/prompts.ts', true);
    for (const invoke of [
        () => api.fetchPrompts(), () => api.fetchSourcePrompts('old-source'),
        () => api.fetchPromptSourceStatuses(), () => api.refreshSource('old-source'),
        () => api.refreshAllSources(), () => api.refreshDueSources(1),
    ]) await assert.rejects(invoke(), denied);
});

test('关闭来源操作不改旧来源、刷新偏好、Excel来源偏好或已有缓存', () => {
    const oldSource = { id: 'kept', enabled: true, builtIn: false, name: '原来源' };
    const persisted = { sources: [oldSource], schedule: { intervalMinutes: 30, lastFetchedAt: '2026-11-01' },
        excelSources: { product: { enabled: true } } };
    const before = JSON.stringify(persisted);
    let store;
    const f = variantModules({
        '@/扩展功能/产品配置/脚本与提示词来源': { requireBusinessFeature() { throw Object.assign(Error('关闭'), denied); } },
        zustand: { create: () => initializer => {
            const get = () => store;
            store = initializer(patch => { store = { ...store, ...(typeof patch === 'function' ? patch(store) : patch) }; }, get);
            return { getState: get };
        } },
        'zustand/middleware': { createJSONStorage: () => ({}), persist: (initializer, options) => (set, get) =>
            options.merge(persisted, initializer(set, get)) },
        '@/扩展功能/本机存储/上游浏览器存储桥': { sqliteStateStorage: {} },
        '@/services/api/prompt-source-presets': { DEFAULT_PROMPT_SOURCES: [], createPromptSource: value => ({ ...value }) },
    });
    const api = f.load('stores/use-prompt-source-store.ts', true).usePromptSourceStore.getState();
    for (const invoke of [
        () => api.addSource(), () => api.saveSource({ ...oldSource, name: 'new' }),
        () => api.removeSource(oldSource.id), () => api.toggleSource(oldSource.id, false),
        () => api.patchExcelSource('product', { enabled: false }), () => api.updateSchedule('intervalMinutes', 0),
    ]) assert.throws(invoke, denied);
    assert.deepEqual(api.sources, persisted.sources);
    assert.deepEqual(api.schedule, persisted.schedule);
    assert.deepEqual(api.excelSources, persisted.excelSources);
    assert.equal(JSON.stringify(persisted), before);
});

test('侧栏恢复提示词库，其他四个页签保留，选中prompts挂载来源内容', () => {
    for (const selected of ['canvas', 'prompts']) {
        let stateCalls = 0;
        const api = renderModule('components/canvas/canvas-side-panel.tsx', {
            react: { ...react, useState: value => [stateCalls++ === 0 ? selected : value, () => {}] },
            '@/stores/use-canvas-side-panel-store': { useCanvasSidePanelStore: selector =>
                selector({ width: 320, panelOpen: true, panelMounted: true, panelClosing: false }) },
            '@/扩展功能/主题/侧栏动效': { panelTransition: () => ({}), useHiddenPanelExit() {} },
            '@/扩展功能/主题/统一页签横条': { TAB_INDICATOR_BASE_STYLE: {}, useUnifiedTabIndicator() {} },
            '@/扩展功能/主题/页签内容过渡': { TabContentTransition: 'TabContentTransition', useNativeTabFade() {} },
        });
        const nodes = elements(api.CanvasSidePanel({ projectId: 'kept', nodes: [], connections: [], selectedNodeIds: new Set() }));
        const labels = nodes.filter(node => node.props?.label).map(node => node.props.label);
        assert.deepEqual(labels, ['canvas.sidePanel.canvas', 'canvas.sidePanel.assets', 'canvas.sidePanel.prompts', '生成历史', '回收站']);
        assert.equal(nodes.some(node => node.type?.name === 'CanvasPromptsTab'), selected === 'prompts');
        if (selected === 'canvas') assert.ok(nodes.some(node => node.type?.name === 'CanvasNodesTab'));
    }
});

test('画布输入区恢复提示词库入口', () => {
    const api = renderModule('components/canvas/canvas-prompt-library.tsx');
    assert.ok(api.CanvasPromptLibrary({ onSelect() {} }));
});

test('设置页恢复提示词来源页签，初始页签直达来源且其他设置保留', () => {
    const api = renderModule('components/layout/app-config-modal.tsx', {
        antd: { App: { useApp: () => ({ message: {} }) }, Form: { Item: 'FormItem' },
            Input: { TextArea: 'TextArea' }, Radio: { Group: 'RadioGroup', Button: 'RadioButton' } },
        '@/扩展功能/产品配置/功能开关': variantModules().load('产品配置/功能开关.ts'),
        '@/stores/use-config-store': { useConfigStore: selector =>
            selector({ config: { channels: [] }, webdav: { url: '' } }), selectableModelsByCapability: () => [] },
        '@/lib/media-size': { mediaScaleOptions: [], inferMediaScale: () => 'auto', parseVideoResolution: () => 'auto' },
    });
    const nodes = elements(api.AppConfigPanel({ initialTab: 'prompt-sources' }));
    const tabs = nodes.find(node => Array.isArray(node.props?.items));
    assert.ok(tabs);
    assert.equal(tabs.props.activeKey, 'prompt-sources');
    assert.equal(tabs.props.items.some(item => item.key === 'prompt-sources'), true);
    for (const key of ['channels', 'fallback', 'local-proxy', 'preferences', 'local-storage', 'software-updates'])
        assert.ok(tabs.props.items.some(item => item.key === key), key);
});
