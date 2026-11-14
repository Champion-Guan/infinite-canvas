import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

const jsx = (type, props) => ({ type, props }), all = node => Array.isArray(node) ? node.flatMap(all)
    : node && typeof node === 'object' ? [node, ...all(node.props?.children)] : [];
const snapshot = () => ({
    projects: [
        { id: 'unbound', title: '独立产品', createdAt: '2026-11-03', productSetId: null, nodes: [] },
        { id: 'second', title: '第二份工作表的产品', createdAt: '2026-11-02', productSetId: 'book2', nodes: [] },
        { id: 'first', title: '原工作表的产品', createdAt: '2026-11-01', productSetId: 'book1', nodes: [] },
    ],
    deletedProjects: [],
    guanWorkbooks: { version: 1, activeByWorkbook: { book1: 'first', book2: 'second' }, contract: {
        workspace: { activeProductSetId: 'book1', activeProductId: 'first' },
        products: [], productSets: [{ id: 'book1' }, { id: 'book2' }],
    } },
});
test('Excel开关默认关闭，文件读取和解析库在访问文件、DOM前直接拒绝', async () => {
    const f = variantModules(), feature = f.load('产品配置/功能开关.ts'), reader = f.load('Excel/Excel文件读取.ts');
    assert.equal(feature.productFeatures.excel, false);
    assert.throws(() => reader.loadLocalExcelLibrary(), { code: 'product_feature_disabled' });
    let touched = false;
    await assert.rejects(reader.readExcelFile({ get name() { touched = true; return '产品.xlsx'; } }, null, () => assert.fail()), { code: 'product_feature_disabled' });
    assert.equal(touched, false);
});
test('全部已有产品统一导航，刷新优先原产品记忆，旧工作簿数据和归属不改变', () => {
    const f = variantModules(), scope = f.load('产品/产品导航范围.ts'), state = snapshot(), original = JSON.stringify(state);
    for (const id of ['first', 'second', 'unbound']) {
        assert.deepEqual(scope.navigationProducts(state, id).map(p => p.id), ['first', 'second', 'unbound']);
        assert.equal(scope.navigationOwner(state, id), null);
        assert.equal(scope.navigationEntry(state, id), id);
        assert.equal(scope.navigationSelection(state, id), state);
        assert.equal(scope.navigationWorkbookMemory(state, id), null);
    }
    assert.equal(scope.navigationEntry(state, 'deleted'), 'first');
    assert.equal(JSON.stringify(state), original);
});
test('顶栏保留产品和ZIP导入，Excel标签与选择器不挂载', () => {
    const f = variantModules({
        react: { lazy: () => 'LazyComponent', useRef: value => ({ current: value }) }, 'react/jsx-runtime': { jsx, jsxs: jsx },
        antd: { App: { useApp: () => ({ message: {} }) } },
        '../Excel/Excel工作簿选择': { ExcelWorkbookPicker: 'ExcelPicker' },
        '../产品/顶部产品胶囊': { ProductCapsules: 'ProductTabs' },
        '../产品/产品回收面板': { ProductTrashEntry: 'ProductRecycle' },
        '../产品/产品操作': { useProductNavigation: () => ({ busy: false }) },
        '@/components/ui/animated-theme-toggler': { AnimatedThemeToggler: 'Theme' },
        '@/stores/use-config-store': { useConfigStore: fn => fn({}) },
        '@/stores/use-theme-store': { useThemeStore: fn => fn({ theme: 'light' }) },
        './旧版顶栏.module.css': { default: {} },
    });
    const nodes = all(f.load('首页/旧版首页顶栏.tsx').LegacyHomeChrome());
    assert.ok(nodes.some(n => n.type === 'ProductTabs'));
    assert.equal(nodes.some(n => n.type === 'ExcelPicker' || n.props?.children === '当前工作表：'), false);
    assert.equal(nodes.some(n => n.type === 'Theme'), false, '顶栏主题按钮按用户要求隐藏');
    assert.ok(nodes.some(n => n.type === 'input' && n.props.accept === 'application/zip,.zip'));
    assert.ok(nodes.some(n => n.props?.title === '新建产品'));
});
test('真实画布存储创建与ZIP导入产品不再关联工作表，原归属与工作表保持', () => {
    let sequence = 0;
    const f = variantModules({
        zustand: { create: () => initializer => {
            let state;
            const get = () => state, set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
            state = initializer(set, get);
            return { getState: get, setState: set };
        } },
        'zustand/middleware': { persist: initializer => initializer },
        '@/扩展功能/本机存储/上游浏览器存储桥': { scheduleStateSave() { assert.fail('夹具不写本机数据'); } },
        '@/扩展功能/画布生成/批量保存协调': { shouldDeferCanvasPersist: () => false },
        '@/扩展功能/图片设置/图片信息偏好': { imageInfoDefaults: {}, withCanvasAppearanceDefaults: value => value },
        '@/lib/localforage-storage': { localForageStorage: {} },
        nanoid: { nanoid: () => `created-${++sequence}` },
    });
    const store = f.load('stores/canvas/use-canvas-store.ts', true).useCanvasStore, old = snapshot();
    store.setState(old);
    const createdId = store.getState().createProject();
    const importedId = store.getState().importProject({ title: 'ZIP独立画布', nodes: [{ id: 'kept-node' }], connections: [] });
    assert.equal(store.getState().openProject(createdId).productSetId, null);
    assert.equal(store.getState().openProject(importedId).productSetId, null);
    assert.equal(store.getState().openProject('first').productSetId, 'book1');
    assert.equal(store.getState().guanWorkbooks, old.guanWorkbooks);
    assert.equal(store.getState().openProject(importedId).nodes[0].id, 'kept-node');
});
test('Excel提示词来源全部关闭，但保留旧卡片读取本产品上下文的兼容能力', () => {
    const state = snapshot();
    state.guanWorkbooks.contract.products = [{ id: 'first', productSetId: 'book1', identity: { titleZh: '原产品' } }];
    state.guanWorkbooks.contract.productSets[0].source = { fileName: '原数据.xlsx', promptTemplates: [
        { id: 't', route: '原产品', prompts: { main: '原提示词内容' } },
    ] };
    const f = variantModules({
        react: { createContext: () => ({}), useMemo: fn => fn(), useContext: () => 'first' },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: fn => fn(state) },
        '@/stores/use-prompt-source-store': { usePromptSourceStore: fn => fn({ excelSources: {} }) },
    });
    const scope = f.load('Excel画布/Excel画布上下文.tsx');
    assert.equal(scope.useExcelPromptSource('first'), null);
    assert.deepEqual(scope.useExcelWorkbookSources(), []);
    const context = scope.useExcelPromptContext('first');
    assert.equal(context.fileName, '原数据.xlsx');
    assert.equal(context.templates[0].prompts.main, '原提示词内容');
});
test('旧页面残留Excel插入和同步均不改画布，普通参数卡仍可创建且不读取模板', () => {
    const effects = [], errors = [], ctx = { productId: 'first', fileName: 'old.xlsx', templates: [{ id: 'template' }] };
    let captured;
    const f = variantModules({
        react: { useCallback: fn => fn, useEffect: fn => effects.push(fn) },
        './Excel卡片事务': { insertExcelPromptCards() { assert.fail('不应插入Excel卡'); },
            createProductParameterNode(context, center, values) { captured = context; return { context, center, values }; } },
        './旧版提示词同步': { syncExcelPromptNodes() { assert.fail('不应自动同步'); } },
        './Excel拖入校验': { parseExcelPromptDrop: () => ({ productId: 'first' }) },
        './Excel参数记忆': { readProductParameterValues: () => ({ old: '保留' }) },
    });
    const port = { projectId: 'first', productActive: true, projectLoaded: true, restoredProjectIdRef: { current: 'first' }, excelContext: ctx,
        nodesRef: { current: [] }, connectionsRef: { current: [] }, message: { error: value => errors.push(value) } };
    const insertion = f.load('Excel画布/Excel插入操作.ts').useExcelCanvasInsertion(port);
    insertion.insertExcelCards({ productId: 'first' });
    effects.forEach(fn => fn());
    assert.match(errors[0], /Excel 功能已在本产品关闭/);
    assert.deepEqual(port.nodesRef.current, []);
    const card = f.load('Excel画布/Excel参数操作.ts').useExcelParameterOperations(port).createParameterNode({ x: 1, y: 2 });
    assert.deepEqual(captured.templates, []);
    assert.equal(captured.fileName, '');
    assert.equal(card.values.old, '保留');
    assert.equal(ctx.templates[0].id, 'template');
});
