import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';

function hooks() {
    const cells = [], effects = [];
    let cursor = 0;
    return {
        reset() { cursor = 0; effects.length = 0; },
        commit() { effects.forEach(fn => fn()); },
        react: {
            useRef(current) { return cells[cursor++] ||= { current }; },
            useState(value) {
                const id = cursor++;
                if (!(id in cells)) cells[id] = typeof value === 'function' ? value() : value;
                return [cells[id], next => { cells[id] = next; }];
            },
            useMemo(fn, deps) {
                const id = cursor++, old = cells[id];
                if (!old || deps.some((value, i) => value !== old.deps[i])) cells[id] = { deps, value: fn() };
                return cells[id].value;
            },
            useCallback(fn, deps = []) {
                const id = cursor++, old = cells[id];
                if (!old || deps.some((value, i) => value !== old.deps[i])) cells[id] = { deps, value: fn };
                return cells[id].value;
            },
            useLayoutEffect(fn, deps) {
                const id = cursor++, old = cells[id];
                if (!deps || !old || deps.some((value, i) => value !== old[i])) effects.push(fn);
                cells[id] = deps;
            },
            useEffect() {},
        },
    };
}

test('连续勾选复用正文快照，任何其他元数据或变体资料变化都使正文失效', () => {
    const { parameter } = variantFixture(), original = parameter.metadata;
    const snapshot = variantModules().load('Excel画布/变体正文快照.ts').variantContentSnapshot;
    const unchecked = { ...original, productVariants: original.productVariants.map(item => ({ ...item, enabled: false })) };
    assert.equal(snapshot(original, unchecked), original);
    assert.ok(unchecked.productVariants.every(item => !item.enabled));
    for (const changed of [
        { ...unchecked, productVariants: [...unchecked.productVariants].reverse() },
        { ...unchecked, productVariants: unchecked.productVariants.slice(1) },
        ...['name', 'attributes', 'imageIds', 'primaryImageId', 'brief', 'variableValues'].map(key => ({
            ...unchecked, productVariants: [{ ...unchecked.productVariants[0], [key]: key === 'name' ? '新名称' : {} }, unchecked.productVariants[1]],
        })),
        ...['productBrief', 'productMainImages', 'productConfirmations', 'productImagePlan', 'productPlatform', 'productLanguage', 'customPluginField']
            .map(key => ({ ...unchecked, [key]: {} })),
    ]) assert.equal(snapshot(original, changed), changed);
    assert.equal(snapshot(original, undefined), undefined);
});

test('勾选导致的重渲染不再测量文本框，文本、主题和尺寸改变仍会更新镜像', t => {
    const state = hooks(), oldCss = globalThis.getComputedStyle, oldObserver = globalThis.ResizeObserver;
    let reads = 0, theme = 'light', observer;
    globalThis.getComputedStyle = () => { reads++; return { color: theme === 'light' ? '#111' : '#eee', padding: '8px' }; };
    globalThis.ResizeObserver = class { constructor(callback) { observer = callback; } observe() {} disconnect() {} };
    t.after(() => { globalThis.getComputedStyle = oldCss; globalThis.ResizeObserver = oldObserver; });
    const jsx = (type, props) => ({ type, props });
    const loader = variantModules({ react: state.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
        './双语联动文本框.module.css': { default: {} },
        '@/stores/use-theme-store': { useThemeStore: select => select({ theme }) },
    });
    const component = loader.load('提示词/双语联动文本框.tsx').BilingualPromptField;
    const link = { ready: true, highlight: {}, fields: { current: {} } };
    const input = { clientLeft: 1, clientTop: 1, clientWidth: 300, clientHeight: 160, scrollLeft: 0, scrollTop: 0, parentElement: {} };
    const render = value => {
        state.reset();
        const tree = component({ link, language: 'chinese', value, style: { color: '#111' } });
        const [textarea, pane] = tree.props.children;
        textarea.props.ref.current = input;
        pane.props.ref.current ||= { style: {} };
        pane.props.children.props.ref.current ||= { style: {} };
        state.commit();
    };
    render('产品提示词'); const baseline = reads;
    for (let i = 0; i < 100; i++) render('产品提示词');
    assert.equal(reads, baseline);
    render('新提示词'); assert.equal(reads, baseline + 2);
    theme = 'dark'; render('新提示词'); assert.equal(reads, baseline + 4);
    input.clientWidth = 400; observer(); assert.equal(reads, baseline + 6);
});

test('100次勾选不重新编译正文或解析引用，编辑资料和切换变体时立即更新', () => {
    const state = hooks(), { parameter, text, nodes, connections } = variantFixture();
    let compiled = 0, projected = 0;
    const pair = { chinese: '中文商品提示词', english: 'Actual product reference', translatedChinese: '中文商品提示词' };
    text.type = 'guan:product-prompt';
    text.metadata = { productImagePrompt: { key: 'main', name: '主图', parameterId: parameter.id,
        delivery: { width: 800, height: 800, format: 'png' }, prompt: pair, variants: { red: pair, blue: { ...pair, chinese: '蓝色商品' } } } };
    const jsx = (type, props) => ({ type, props });
    const loader = variantModules({
        react: state.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
        'lucide-react': {}, './Excel画布上下文': { useExcelProductId: () => 'product' }, './商品策划请求': {},
        './商品提示词状态': { productPromptProblems: () => [] },
        './商品待确认提示词': { compileConfirmationPair(value) { compiled++; return { pair: value, ranges: { chinese: [], english: [] }, sections: {}, states: [] }; } },
        './图片引用标签规则': { imageReferenceCatalog: () => [], projectImageReferences(value) { projected++; return { text: value, occurrences: [], position: n => n }; } },
        './图片引用标签': {}, './商品待确认编辑': {}, './提示词变体选择': {},
        '../主题/页签内容过渡': {}, '../提示词/双语联动文本框': { useBilingualPromptSync: () => ({}) },
    });
    const component = loader.load('Excel画布/商品提示词卡片.tsx').ProductPromptContent;
    const ctx = { node: text, theme: { node: {} }, getNode: id => nodes.find(item => item.id === id), getConnections: () => connections };
    const render = () => { state.reset(); return component({ ctx }); };
    render();
    for (let i = 0; i < 100; i++) {
        parameter.metadata = { ...parameter.metadata, productVariants: parameter.metadata.productVariants.map(item => ({ ...item, enabled: i % 2 === 0 })) };
        render();
    }
    assert.equal(compiled, 1);
    assert.equal(projected, 2);
    parameter.metadata = { ...parameter.metadata, productConfirmations: [] };
    render(); assert.equal(compiled, 2);
    loader.load('Excel画布/共用商品提示词.ts').selectProductPromptVariant(text.id, 'blue');
    text.metadata.productImagePrompt = { ...text.metadata.productImagePrompt, variantId: 'blue' };
    render(); assert.equal(compiled, 3);
    assert.equal(projected, 6);
});

test('纯元数据操作只更新节点和撤销，保留选中项、连线和视区身份；选择命令仍正常执行', () => {
    const state = hooks(), f = variantFixture(), calls = [], selected = new Set(['prompt']);
    const viewport = { x: 10, y: 20, k: 0.78 };
    const refs = { nodesRef: { current: f.nodes }, connectionsRef: { current: f.connections },
        selectedNodeIdsRef: { current: selected }, viewportRef: { current: viewport }, generateNodeRef: { current: null } };
    const loader = variantModules({ react: state.react, '@/stores/use-agent-store': { useAgentStore: select => select({ setCanvasContext() {} }) } });
    const bridge = loader.load('pages/canvas/hooks/use-agent-bridge.ts', true).useAgentBridge({
        projectId: 'product', nodes: f.nodes, connections: f.connections, selectedNodeIds: selected, viewport, ...refs,
        ...Object.fromEntries(['setNodes', 'setConnections', 'setSelectedNodeIds', 'setSelectedConnectionId', 'setViewport', 'setContextMenu']
            .map(key => [key, value => calls.push({ key, value })])),
    });
    for (let i = 0; i < 50; i++) bridge.applyAgentOps([{ type: 'update_node', id: 'parameter',
        metadata: { productVariants: f.parameter.metadata.productVariants.map(item => ({ ...item, enabled: i % 2 === 0 })) } }]);
    assert.equal(refs.selectedNodeIdsRef.current, selected);
    assert.equal(refs.connectionsRef.current, f.connections);
    assert.equal(refs.viewportRef.current, viewport);
    assert.deepEqual([...new Set(calls.map(item => item.key))], ['setNodes']);
    bridge.applyAgentOps([{ type: 'select_nodes', ids: ['parameter'] }]);
    assert.deepEqual([...refs.selectedNodeIdsRef.current], ['parameter']);
    assert.ok(calls.some(item => item.key === 'setSelectedNodeIds'));
});
