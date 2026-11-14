import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { variantModules } from './产品变体生成夹具.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function load(file, dependencies, globals = {}) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}
function hooks() {
    const cells = []; let cursor = 0;
    const api = {
        useState(initial) {
            const index = cursor++;
            cells[index] ||= { value: typeof initial === 'function' ? initial() : initial };
            return [cells[index].value, value => { cells[index].value = typeof value === 'function' ? value(cells[index].value) : value; }];
        },
        useRef: value => api.useState(() => ({ current: value }))[0],
        useCallback(callback, deps) {
            const index = cursor++, old = cells[index];
            if (!old || deps.some((value, i) => value !== old.deps[i])) cells[index] = { value: callback, deps };
            return cells[index].value;
        },
        useEffect(callback, deps) {
            const index = cursor++, old = cells[index];
            if (!old || deps.some((value, i) => value !== old.deps[i])) {
                old?.cleanup?.(); cells[index] = { deps, cleanup: callback() };
            }
        },
    };
    return { api, render(callback) { cursor = 0; return callback(); }, unmount() { cells.forEach(cell => cell.cleanup?.()); } };
}
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const all = value => Array.isArray(value) ? value.flatMap(all) : value && typeof value === 'object' ? [value, ...all(value.props?.children), ...all(value.props?.footer)] : [];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const phaseModule = load('扩展功能/主题/任务阶段反馈.tsx', { 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { LoaderCircle: 'Spinner' } });

test('工作簿内旧数字日期不使产品胶囊崩溃，排序和入口共享兼容规则且不改原数据', () => {
    const rules = load('扩展功能/产品/产品规则.ts', {});
    const workbook = load('扩展功能/Excel/Excel产品归属.ts', {
        './旧版Excel合同.js': {}, '../产品/旧版产品显示名.js': {}, '../产品/产品规则': rules,
        '../图片设置/图片信息偏好': {}, '../Excel画布/产品参数卡片默认': {},
    });
    const projects = [{ id: 'later', productSetId: 'book', createdAt: '2026-11-06T00:00:00.000Z' },
        { id: 'older', productSetId: 'book', createdAt: Date.parse('2026-11-05T00:00:00.000Z') }];
    const before = structuredClone(projects);
    assert.deepEqual(workbook.orderedWorkbookProjects(projects, 'book').map(item => item.id), ['older', 'later']);
    assert.equal(workbook.workbookEntry({ projects, guanWorkbooks: null }, 'book'), 'older');
    assert.deepEqual(projects, before);
    const books = { contract: { productSets: [
        { id: 'book', source: { fileName: '同名.xlsx', importedAt: '2026-11-05T00:00:00.000Z' } },
        { id: 'other', source: { fileName: '同名.xlsx', importedAt: '2026-11-06T00:00:00.000Z' } },
    ] }, activeByWorkbook: { book: 'older' } };
    const details = workbook.workbookChoiceDetails(books, projects.map(project => ({ ...project, title: project.id === 'older' ? '蜡烛共用尺寸' : '其他' })));
    assert.match(details.get('book'), /蜡烛共用尺寸.*2 个产品/);
    assert.match(details.get('other'), /0 个产品/);
    assert.notEqual(details.get('book'), details.get('other'), '同名工作簿必须有可区分的描述');
});

test('任务阶段不制造百分比，响应与真实保存分开，取消不冒充远端任务已取消', () => {
    assert.match(phaseModule.textTaskPhaseLabel('saving-task', 'planning'), /保存策划任务/);
    assert.match(phaseModule.textTaskPhaseLabel('requesting', 'optimization'), /等待模型优化结果/);
    assert.match(phaseModule.textTaskPhaseLabel('streaming', 'planning'), /正在生成策划内容/);
    assert.match(phaseModule.textTaskPhaseLabel('saving-result', 'optimization'), /收到.*正在保存/);
    assert.match(phaseModule.textTaskPhaseLabel('stopped', 'optimization'), /停止本次等待.*原任务恢复/);
    const tree = phaseModule.TextTaskStatus({ phase: 'saving-result', kind: 'optimization' });
    assert.equal(tree.props.role, 'status'); assert.equal(tree.props['aria-live'], 'polite');
    assert.equal(tree.props['data-text-task-phase'], 'saving-result');
});

test('侧栏弹簧可中断，手势和减少动态效果不经过几何补间', () => {
    const { panelTransition, APPLE_PANEL_SPRING } = load('扩展功能/主题/侧栏动效.ts', { react: {} });
    assert.deepEqual(panelTransition(true, false), { duration: 0 });
    assert.deepEqual(panelTransition(false, true), { duration: 0 });
    assert.equal(panelTransition(false, false), APPLE_PANEL_SPRING);
    assert.ok(APPLE_PANEL_SPRING.damping / (2 * Math.sqrt(APPLE_PANEL_SPRING.stiffness * APPLE_PANEL_SPRING.mass)) >= 1);
});

test('页面隐藏结束本次关闭，非活动产品不提前结束活动侧栏，卸载移除监听', () => {
    const runtime = hooks(), listeners = new Set(), calls = [];
    const document = { visibilityState: 'visible', addEventListener: (_event, fn) => listeners.add(fn), removeEventListener: (_event, fn) => listeners.delete(fn) };
    const { useHiddenPanelExit } = load('扩展功能/主题/侧栏动效.ts', { react: runtime.api }, { document });
    const finish = revision => calls.push(revision);
    const render = (active, closing, revision) => runtime.render(() => useHiddenPanelExit(active, closing, revision, finish));
    render(false, true, 1); assert.equal(listeners.size, 0);
    render(true, true, 2); assert.equal(listeners.size, 1);
    document.visibilityState = 'hidden'; for (const callback of listeners) callback();
    assert.deepEqual(calls, [2]);
    render(true, false, 2); assert.equal(listeners.size, 0);
    runtime.unmount();
});

test('真实侧栏组件：键盘调宽立即跟随，松键恢复弹簧，关闭阶段不可继续聚焦内部控件', () => {
    const source = readFileSync(new URL('../.运行/3100源/画布副本/web/src/components/canvas/canvas-side-panel.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CanvasSidePanel');
    assert.ok(declaration);
    const code = ts.transpileModule(declaration.getText(ast).replace(/^export /, ''), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const runtime = hooks(), writes = [], completed = [];
    const state = { width: 280, panelMounted: true, panelOpen: true, panelClosing: false, panelCloseRevision: 1,
        setWidth: width => { state.width = width; }, finishPanelClose: revision => completed.push(revision) };
    let reduced = false, active = true;
    const { panelTransition } = load('扩展功能/主题/侧栏动效.ts', { react: {} });
    const scope = {
        businessFeatures: { promptLibrary: true },
        ...runtime.api, useTranslation: () => ({ t: key => key }), canvasThemes: { light: { toolbar: {}, node: {} } },
        useThemeStore: select => select({ theme: 'light' }), useCanvasSidePanelStore: select => select(state),
        useReducedMotion: () => reduced, useProductActive: () => active, useHiddenPanelExit() {}, panelTransition,
        CANVAS_SIDE_PANEL_MIN_WIDTH: 220, CANVAS_SIDE_PANEL_MAX_WIDTH: 480,
        motion: { div: 'motion.div', aside: 'motion.aside' }, LayoutGroup: 'LayoutGroup', TabButton: 'TabButton', CanvasNodesTab: 'Nodes',
        CanvasAssetsTab: 'Assets', CanvasGenerationHistoryTab: 'History', CanvasRecycleBinTab: 'Trash', CanvasPromptsTab: 'Prompts',
        TabContentTransition: 'TabTransition',
        useNativeTabFade() {}, useUnifiedTabIndicator() {}, TAB_INDICATOR_BASE_STYLE: {},
        sqlitePreferences: { setItem: (...args) => writes.push(args) },
    };
    const component = new Function('require', 'exports', ...Object.keys(scope), code + ';return CanvasSidePanel;')(
        id => { assert.equal(id, 'react/jsx-runtime'); return { jsx, jsxs: jsx }; }, {}, ...Object.values(scope));
    const render = () => runtime.render(() => component({ projectId: 'product', nodes: [], connections: [] }));
    let tree = render();
    const separator = () => all(tree).find(item => item.props.role === 'separator');
    let prevented = false;
    separator().props.onKeyDown({ key: 'ArrowRight', preventDefault: () => { prevented = true; } });
    tree = render();
    assert.equal(prevented, true); assert.equal(state.width, 296);
    assert.deepEqual(tree.props.transition, { duration: 0 });
    separator().props.onKeyUp(); tree = render(); assert.equal(tree.props.transition.type, 'spring');
    reduced = true; tree = render(); assert.deepEqual(tree.props.transition, { duration: 0 });
    state.panelClosing = true; state.panelOpen = false; state.panelCloseRevision = 2;
    tree = render();
    assert.equal(all(tree).find(item => item.type === 'motion.aside').props.inert, true);
    assert.equal(tree.props.style.pointerEvents, 'none');
    tree.props.onAnimationComplete(); assert.deepEqual(completed, [2]);
    active = false; tree = render(); tree.props.onAnimationComplete(); assert.deepEqual(completed, [2]);
    assert.deepEqual(writes, [['canvas-side-panel-width', '296']]);
    state.panelOpen = true; state.panelClosing = false; active = true;
    for (const [tab, label, child] of [
        ['assets', 'canvas.sidePanel.assets', 'Assets'], ['prompts', 'canvas.sidePanel.prompts', 'Prompts'],
        ['history', '生成历史', 'History'], ['trash', '回收站', 'Trash'], ['canvas', 'canvas.sidePanel.canvas', 'Nodes'],
        ['trash', '回收站', 'Trash'], ['assets', 'canvas.sidePanel.assets', 'Assets'],
    ]) {
        tree = render();
        all(tree).find(item => item.type === 'TabButton' && item.props.label === label).props.onClick();
        tree = render();
        const contents = all(tree).filter(item => item.type === 'TabTransition');
        assert.equal(contents.length, 1, '快速切换始终只挂载一个页签内容，不等待上一页退场');
        assert.equal(contents[0].props.transitionKey, `product:${tab}`);
        assert.equal(contents[0].props.enabled, true);
        assert.match(contents[0].props.className, /overflow-hidden/);
        assert.equal(contents[0].props.children.type, child);
        all(tree).find(item => item.type === 'TabButton' && item.props.label === label).props.onClick();
        assert.equal(all(render()).find(item => item.type === 'TabTransition').props.transitionKey, contents[0].props.transitionKey, '重复点击当前页签不会重新入场');
    }
});

test('侧栏页签复用统一双向过渡，不叠加历史入场或逐项延迟', () => {
    const css = readFileSync(new URL('../扩展功能/主题/页签内容过渡.module.css', import.meta.url), 'utf8');
    assert.doesNotMatch(css, /animation-delay|animation-fill-mode|will-change/);
    const history = readFileSync(new URL('../扩展功能/生成历史/生成历史页签.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(history, /guan-apple-enter|guan-apple-stagger/);
});

test('图片叠层与端点不再过渡所有属性，标题不常驻重绘背景与阴影', () => {
    const node = readFileSync(new URL('../.运行/3100源/画布副本/web/src/components/canvas/canvas-node.tsx', import.meta.url), 'utf8');
    assert.ok(!node.includes('transition-all'));
    assert.match(node, /transition-\[transform,translate,opacity,background-color,border-color\]/);
    const css = readFileSync(new URL('../.运行/3100源/画布副本/web/src/styles/globals.css', import.meta.url), 'utf8');
    assert.ok(!css.includes('animation: ai-title-aurora'));
    assert.ok(!css.includes('@keyframes ai-title-aurora'));
});

function optimizationFixture() {
    const runtime = hooks(), requests = [], saves = [], applied = [], notices = [];
    const nodes = [{ id: 'a', title: '第一张', metadata: { content: '原文A' } }, { id: 'b', title: '第二张', metadata: { content: '原文B' } }];
    const source = node => ({ id: node.id, title: node.title, signature: node.id + node.metadata.content, text: node.metadata.content, problems: [], kind: 'text' });
    const config = { model: 'text-model' };
    const useConfigStore = selector => selector({ config });
    useConfigStore.getState = () => ({ config });
    const module = load('扩展功能/提示词/提示词优化窗口.tsx', {
        react: runtime.api, 'react/jsx-runtime': { jsx, jsxs: jsx },
        'motion/react': { AnimatePresence: 'Presence' }, '../主题/苹果弹窗': { AppleModal: 'Modal' },
        antd: { App: { useApp: () => ({ message: { info: value => notices.push(value), success: value => notices.push(value), warning: value => notices.push(value) } }) }, Button: 'Button', Input: { TextArea: 'TextArea' }, Modal: 'Modal', Tooltip: 'Tooltip' },
        'lucide-react': { ChevronDown: 'ChevronDown', Sparkles: 'Sparkles' },
        '@/stores/use-config-store': { useConfigStore, decodeChannelModel: () => null },
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: () => config },
        '../产品/产品操作': { saveProductCanvas: () => { const pending = deferred(); saves.push(pending); return pending.promise; } },
        './提示词优化请求': { requestPromptOptimization: options => { const pending = deferred(); requests.push({ options, ...pending }); return pending.promise; } },
        './提示词优化规则': { canOptimizePrompt: () => true, readPromptOptimizationSource: source, parseOptimizedPrompt: JSON.parse, promptOptimizationOps: (original, result) => [{ id: original.id, text: result.text }] },
        './提示词优化窗口.module.css': { default: {} },
        './快捷优化方向': { normalizeOptimizationDirections: value => value || [], OPTIMIZATION_DIRECTIONS: [] },
        '../产品配置/模型配置门禁': { ensureModelConfigured: () => true },
        './双语联动文本框': { BilingualPromptField: 'Field', useBilingualPromptSync: () => ({}) },
        '../主题/任务阶段反馈': { TextTaskStatus: 'Status' },
        '../主题/苹果交互按钮': { AppleAntButton: 'Button' },
        '../Excel画布/图片引用标签规则': variantModules().load('Excel画布/图片引用标签规则.ts'),
        '../Excel画布/图片引用标签': { ImageReferenceToken: 'ImageToken' },
        '../Excel画布/商品提示词规则': variantModules().load('Excel画布/商品提示词规则.ts'),
    });
    let active = true;
    const host = { getNode: id => nodes.find(node => node.id === id), getNodes: () => nodes, applyOps: ops => applied.push(ops) };
    const render = () => runtime.render(() => module.usePromptOptimization({ productId: 'product', active, host, assertActive() {} }));
    const tool = index => render().optimizationTool(nodes[index])[0].onClick();
    const button = label => all(render().optimizationDialog).find(element => element.type === 'Button' && element.props.children === label);
    return { render, tool, button, requests, saves, applied, notices, runtime, deactivate: () => { active = false; render(); } };
}

test('优化点击同步反馈阶段，取消立即可再次操作，迟到旧结果不覆盖新请求', async () => {
    const f = optimizationFixture(); f.render(); f.tool(0);
    f.button('开始优化').props.onClick();
    assert.equal(f.requests.length, 1);
    assert.equal(all(f.render().optimizationDialog).find(element => element.type === 'Status').props.phase, 'preparing');
    f.requests[0].options.onPhase('saving-task');
    assert.equal(all(f.render().optimizationDialog).find(element => element.type === 'Status').props.phase, 'saving-task');
    f.button('取消优化').props.onClick();
    assert.equal(f.requests[0].options.signal.aborted, true);
    assert.ok(f.button('开始优化'));
    f.button('开始优化').props.onClick();
    assert.equal(f.requests.length, 2);
    f.requests[0].options.onPhase('ready'); f.requests[0].resolve({ text: '旧结果' });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(f.button('取消优化'), '旧finally不能清掉新请求的运行状态');
    assert.equal(all(f.render().optimizationDialog).find(element => element.type === 'Status').props.phase, 'preparing');
    f.requests[1].options.onPhase('ready'); f.requests[1].resolve({ text: '新结果', changes: [] });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(f.button('重新优化')); assert.equal(f.applied.length, 0);
});

test('打开另一张卡片会中断旧等待，旧结果和阶段不回写新窗口', async () => {
    const f = optimizationFixture(); f.render(); f.tool(0); f.button('开始优化').props.onClick();
    f.tool(1);
    assert.equal(f.requests[0].options.signal.aborted, true);
    f.requests[0].options.onPhase('saving-result'); f.requests[0].resolve({ text: '属于第一张' });
    await new Promise(resolve => setImmediate(resolve));
    const dialog = f.render().optimizationDialog;
    assert.ok(all(dialog).some(element => element.props.children === '第二张'));
    assert.ok(!all(dialog).some(element => element.type === 'Status'));
    assert.ok(f.button('开始优化'));
});
test('点击优化窗口外部走取消逻辑，停止本次等待，不应用候选或发起新请求', async () => {
    const f = optimizationFixture(); f.render(); f.tool(0);
    assert.equal(all(f.render().optimizationDialog).find(item => item.type === 'Modal').props.maskClosable, true);
    f.button('开始优化').props.onClick();
    all(f.render().optimizationDialog).find(item => item.type === 'Modal').props.onCancel();
    assert.equal(f.requests[0].options.signal.aborted, true);
    f.requests[0].resolve({ text: '迟到结果' }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.render().optimizationDialog.props.children, null);
    assert.equal(f.applied.length, 0); assert.equal(f.requests.length, 1);
});

test('应用等待真实ACK，失败可只重试保存，不重复写卡或重放优化', async () => {
    const f = optimizationFixture(); f.render(); f.tool(0); f.button('开始优化').props.onClick();
    f.requests[0].resolve({ text: '候选', changes: [] }); await new Promise(resolve => setImmediate(resolve));
    f.button('应用到原卡片').props.onClick();
    assert.equal(f.applied.length, 1);
    const lockedModal = all(f.render().optimizationDialog).find(item => item.type === 'Modal');
    assert.equal(lockedModal.props.maskClosable, false);
    lockedModal.props.onCancel(); assert.ok(f.render().optimizationDialog.props.children, '等待保存ACK时保留窗口');
    assert.equal(all(f.render().optimizationDialog).find(element => element.type === 'Status').props.phase, 'applying');
    f.saves[0].reject(Error('合成保存失败')); await new Promise(resolve => setImmediate(resolve));
    f.button('重试保存').props.onClick();
    assert.equal(f.applied.length, 1); assert.equal(f.requests.length, 1);
    f.saves[1].resolve({ persisted: true }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.render().optimizationDialog.props.children, null);
    assert.ok(f.notices.some(text => text.includes('已更新')));
});

test('切走产品立即关闭优化窗口，旧请求不发布成功提示', async () => {
    const f = optimizationFixture(); f.render(); f.tool(0); f.button('开始优化').props.onClick();
    f.deactivate();
    assert.equal(f.requests[0].options.signal.aborted, true);
    f.requests[0].resolve({ text: '旧结果' }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.render().optimizationDialog.props.children, null); assert.deepEqual(f.notices, []);
    f.runtime.unmount();
});
