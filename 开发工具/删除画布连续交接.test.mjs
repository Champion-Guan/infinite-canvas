import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { imageSizeRetryBlocked } from '../扩展功能/媒体交付/生成图片尺寸交付.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const jsx = (type, props, key) => ({ type, props: props || {}, key });
function load(file, dependencies = {}, extra = '') {
    const source = readFileSync(new URL('../扩展功能/' + file, import.meta.url), 'utf8') + extra;
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'window', code)(id => {
        if (id === '../本机存储/启动画面交接.mjs') return { finishStartupScreen() {} };
        assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id];
    }, module, module.exports, { matchMedia: () => ({ matches: false }) });
    return module.exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const rules = load('产品/产品规则.ts');
const tasks = load('产品/产品任务摘要.js', { '../媒体交付/生成图片尺寸交付.mjs': { imageSizeRetryBlocked } });
const recycle = load('产品/产品回收规则.ts', { './产品任务摘要.js': tasks, './产品规则': rules });
const project = (id, owner = 'book', at = '2026-11-06T00:00:00Z') => ({
    id, title: '画布' + id, productSetId: owner, createdAt: at, updatedAt: at,
    nodes: [{ id: id + '-node', type: 'text', metadata: { content: '原内容' } }],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 10, y: 20, k: .7 },
});
const order = () => [project('C'), project('B'), project('A')];

function harness(projects = order(), initiallyActive = 'B', initiallyVisited = ['A', 'B']) {
    let activeId = initiallyActive, flushCount = 0, control = async () => {};
    const state = { hydrated: true, projects, deletedProjects: [], guanWorkbooks: null,
        openProject(id) { return this.projects.find(project => project.id === id); } };
    const preferences = new Map(), navigations = [], writes = [], status = { state: 'saved' };
    const store = selector => selector(state);
    store.getState = () => state;
    store.setState = patch => { Object.assign(state, patch); writes.push(patch); };
    const react = { useCallback: value => value, useLayoutEffect: callback => callback(), useEffect() {},
        useRef: current => ({ current }), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
        useSyncExternalStore: (_subscribe, read) => read(), memo: value => value };
    const router = {
        useMatch: pattern => pattern === '/' ? (!activeId ? {} : null) : activeId ? { params: { id: activeId } } : null,
        useNavigate: () => (url, options) => { navigations.push({ url, options }); activeId = url.startsWith('/canvas/') ? decodeURIComponent(url.slice(8)) : ''; },
        Routes: 'Routes', Route: 'Route', Navigate: 'Navigate',
    };
    const restore = { productRestoreMountGate: { getSnapshot: () => [], subscribe: () => () => {}, release() {} } };
    const storage = { sqlitePreferences: { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value), removeItem: key => preferences.delete(key) },
        storageStatus: () => status, retrySQLiteStorage: async () => {},
        async flushSQLiteStorage() { const count = ++flushCount; status.state = 'saving'; try { await control(count); status.state = 'saved'; } catch (error) { status.state = 'error'; throw error; } } };
    const ownership = { workbookProjects: (items, owner) => items.filter(project => (project.productSetId ?? null) === owner),
        orderedWorkbookProjects: (items, owner) => rules.orderedProducts(items.filter(project => (project.productSetId ?? null) === owner)),
        rememberWorkbookProduct: () => null, visibleWorkbookId: () => 'book', withVisibleSelection: value => value,
        workbookEntry: snapshot => rules.orderedProducts(snapshot.projects.filter(project => project.productSetId === 'book'))[0]?.id ?? null };
    const navigationScope = load('产品/产品导航范围.ts', {
        '../产品配置/功能开关': { productFeatures: { excel: true } },
        '../Excel/Excel产品归属': ownership, './产品规则': rules,
    });
    const navigation = load('产品/产品操作.ts', {
        react, 'react-router-dom': router, '@/stores/canvas/use-canvas-store': { useCanvasStore: store },
        '../画布导入/画布导入': {}, '../本机存储/上游浏览器存储桥': storage, './产品规则': rules, './产品回收规则': recycle,
        './产品保存检查点': { ProductCommitCheckpoint: class { mount() { throw Error('只读交接不应注册检查点'); } } },
        '../Excel删除/工作簿删除规则': {}, '../Excel删除/工作簿删除门禁': { workbookDeletionGate: { getSnapshot: () => false, subscribe: () => () => {} } },
        '../Excel删除/Excel回收站规则': {}, '../Excel/Excel保存导航': {}, '../Excel/Excel产品归属': ownership,
        '../Excel画布/产品参数卡片默认': {}, './产品恢复挂载门禁': restore, '../画布生成/批量保存协调': {},
        '../软件更新/升级页面状态.mjs': { registerUpgradeParticipant() {} },
        './画布驻留保护': { productCanvasResidency: { changed() {}, register() { throw Error('只读画布不应驻留注册'); } } },
        './产品导航范围': navigationScope, '../产品配置/功能开关': { requireProductFeature() {} },
    }, '\nexport { saves as testSaves };');
    for (const item of projects) navigation.testSaves.register(item.id, async () => {});
    const workspace = load('产品/产品工作区.tsx', {
        react: { ...react, useState: initial => [Array.isArray(initial) ? initiallyVisited : initial, () => {}] }, 'react/jsx-runtime': { jsx, jsxs: jsx },
        'react-dom': { flushSync: callback => callback() }, 'react-router-dom': router, 'zustand/react/shallow': { useShallow: callback => callback },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: store }, '@/pages/canvas/project': { default: 'CanvasProject' },
        '@/pages/not-found/index': { default: 'NotFound' }, '../产品配置/画布入口': { CanvasEntry: 'CanvasEntry' },
        './产品界面边界': { ProductSurface: 'ProductSurface' }, './产品恢复挂载门禁': restore,
        '../素材/上传资产规则': { activateAssetProject() {} }, '../画布生成/偏好模型同步': { usePreferredModelSynchronization() {} },
        './画布缓存规则': { PRODUCT_CANVAS_IDLE_TIMEOUT_MS: 300000 }, './画布驻留保护': {},
    });
    const render = () => {
        const tree = workspace.ProductWorkspace(), children = tree.props.children;
        return { ids: children[0].map(child => child.props.id), surfaces: children[0], fallback: children[1]?.type };
    };
    const entry = load('产品配置/画布入口.tsx', {
        react,
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-router-dom': router, 'react-i18next': { useTranslation: () => ({ t: value => value }) },
        antd: { App: { useApp: () => ({ message: {} }) } }, '@/stores/canvas/use-canvas-store': { useCanvasStore: store },
        '@/stores/use-theme-store': { useThemeStore: select => select({ theme: 'light' }) },
        '../本机存储/上游浏览器存储桥': storage, '../产品/产品操作': { ACTIVE_PRODUCT_KEY: 'active', useProductNavigation: navigation.useProductNavigation },
        '../Excel/Excel产品归属': ownership, '../产品/产品恢复挂载门禁': restore, '../首页/工作台首页': { WorkbenchHome: 'WorkbenchHome' },
        '../产品/产品导航范围': navigationScope,
    });
    return { state, render, navigation, navigations, writes, preferences, status, entry: entry.CanvasEntry,
        nav: () => navigation.useProductNavigation(), flushes: () => flushCount, control: callback => { control = callback; } };
}

test('删除归档与导航偏好ACK之间保持原画布实例，不出现无产品首页', async () => {
    const h = harness(), root = deferred(), preference = deferred();
    h.control(count => count === 2 ? root.promise : count === 3 ? preference.promise : undefined);
    const before = h.render().surfaces.find(item => item.props.id === 'B');
    const running = h.nav().recycleProduct('B');
    await settle();
    assert.equal(h.flushes(), 2);
    assert.ok(!h.state.projects.some(project => project.id === 'B'));
    let view = h.render(), retained = view.surfaces.find(item => item.props.id === 'B');
    assert.equal(view.fallback, undefined);
    assert.equal(retained.type, before.type); assert.equal(retained.key, before.key);
    assert.equal(retained.props.active, true);
    assert.equal(retained.props.retiringProject, h.state.deletedProjects[0].project, '直接复用既有回收快照，不再深复制画布');
    assert.deepEqual(h.navigations, []);
    root.resolve(); await settle();
    assert.equal(h.flushes(), 3); assert.ok(h.render().ids.includes('B'));
    preference.resolve(); await running;
    view = h.render();
    assert.equal(h.navigations.at(-1).url, '/canvas/C');
    assert.ok(!view.ids.includes('B')); assert.ok(view.ids.includes('C')); assert.equal(view.fallback, undefined);
});

test('删除保存失败保持原只读背景，重试从回收快照恢复工作簿归属，不误跳首页', async () => {
    for (const failedFlush of [2, 3]) {
        const h = harness();
        h.control(count => { if (count === failedFlush) throw Error('合成删除保存失败'); });
        await assert.rejects(h.nav().recycleProduct('B'), /删除保存失败/);
        assert.equal(h.state.deletedProjects.length, 1);
        assert.equal(h.render().fallback, undefined);
        assert.equal(h.render().surfaces.find(item => item.props.id === 'B').props.retiringProject.id, 'B');
        assert.deepEqual(h.navigations, []);
        h.control(async () => {});
        await h.nav().recycleProduct('B');
        assert.equal(h.state.deletedProjects.length, 1);
        assert.equal(h.navigations.at(-1).url, '/canvas/C', '归档或导航偏好ACK失败后重试，仍应在B原工作簿中选择C');
    }
});

test('删除本工作簿最后一个画布，保存确认前保持原画面，之后才进入真正空状态', async () => {
    const h = harness([project('B'), project('foreign', 'other-book')], 'B', ['B']), root = deferred();
    h.control(count => count === 2 ? root.promise : undefined);
    const running = h.nav().recycleProduct('B'); await settle();
    assert.ok(h.render().ids.includes('B')); assert.equal(h.render().fallback, undefined);
    root.resolve(); await running;
    assert.equal(h.navigations.at(-1).url, '/');
    assert.equal(h.render().fallback, 'CanvasEntry');
    assert.ok(h.state.projects.some(project => project.id === 'foreign'), '不删除或切入其他工作簿');
    assert.equal(h.entry().type, 'WorkbenchHome');
});

test('删除非活动画布不更换背景，也不跳页', async () => {
    const h = harness();
    await h.nav().recycleProduct('A');
    assert.equal(h.render().surfaces.find(item => item.props.id === 'B').props.retiringProject, null);
    assert.equal(h.render().fallback, undefined); assert.deepEqual(h.navigations, []);
});

test('跨工作簿交错创建时只取同工作簿相邻画布', () => {
    const state = { projects: [
        project('C', 'book', '2026-11-06T03:00:00Z'),
        project('foreign', 'other', '2026-11-06T02:00:00Z'),
        project('B', 'book', '2026-11-06T01:00:00Z'),
        project('A', 'book', '2026-11-06T00:00:00Z'),
    ], deletedProjects: [] };
    assert.equal(recycle.planProductRecycle(state, 'B', 'now').deletedProjects[0].nextProductId, 'C');
});

test('删除路由冷启动不重新挂载回收画布；未确认显示状态，已确认可正常恢复入口', async () => {
    const h = harness(order(), 'B', []);
    h.control(count => { if (count === 2) throw Error('合成删除保存失败'); });
    await assert.rejects(h.nav().recycleProduct('B'));
    assert.ok(!h.render().ids.includes('B')); assert.equal(h.render().fallback, 'CanvasEntry');
    assert.equal(h.entry().type, 'main'); assert.equal(h.entry().props.role, 'status');
    h.status.state = 'saved';
    assert.equal(h.entry().type, 'Navigate');
    assert.equal(h.entry().props.to, '/canvas/A');
});

test('只读删除背景不重新注册保存检查点，不写回已归档画布', async () => {
    const h = harness();
    assert.doesNotThrow(() => h.navigation.useProductCanvasSave('readonly', {}, () => true, async () => {
        assert.fail('只读展示不得写入');
    }, () => true, undefined, true));
    await assert.rejects(h.navigation.testSaves.flush('readonly'), /尚未加载/);
});

test('保留删除背景时仍可见，但不接受鼠标、键盘或媒体自动播放', () => {
    const effects = [], played = [];
    const media = { paused: false, ended: false, pause() { this.paused = true; }, play() { played.push(true); return Promise.resolve(); } };
    const container = { querySelectorAll: () => [media], addEventListener() {}, removeEventListener() {} };
    const { ProductSurface } = load('产品/产品界面边界.tsx', {
        react: { createContext: () => ({ Provider: 'Provider' }), useContext() {}, useMemo: callback => callback(),
            useRef: current => ({ current }), useState: () => [container, () => {}], useEffect: effect => effects.push(effect) },
        'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-dom': {}, antd: { App: 'App', ConfigProvider: 'ConfigProvider' },
        '../存储界面/消息浮层布局': { useTransientMessageTop: () => 80 },
        '../主题/页签内容过渡': { useNativeTabFade() {} },
    });
    const tree = ProductSurface({ id: 'B', active: true, retiringProject: project('B'), children: '原画布' });
    assert.equal(tree.props.style.visibility, 'visible');
    assert.equal(tree.props.inert, true);
    assert.equal(tree.props.style.pointerEvents, 'none');
    assert.equal(tree.props.children.props.value.retiringProject.id, 'B');
    effects.forEach(effect => effect());
    assert.equal(media.paused, true);
    assert.deepEqual(played, []);
});
