import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const jsx = (type, props, key) => ({ type, props: props || {}, key });
function load(file, dependencies, globals = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports, ...Object.values(globals));
    return module.exports;
}
const player = load('扩展功能/主题/页签淡变播放器.ts', {}, { getComputedStyle: element => ({ opacity: element.opacity }) });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function element() {
    const animations = [];
    const node = { opacity: '1', animate(frames, options) {
        let resolve, reject;
        const animation = { frames, options, cancelled: false, finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
            complete: () => resolve(), cancel() { this.cancelled = true; reject(Error('cancelled')); } };
        animations.push(animation); return animation;
    } };
    return { node, animations };
}
function fixture() {
    let slots = [], cursor = 0, queued = [], dirty = false, rendering = false, reduced = false;
    const listeners = new Set();
    const document = { visibilityState: 'visible', addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
    const react = {
        useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
            return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; if (rendering) dirty = true; } }]; },
        useRef: initial => react.useState(() => ({ current: initial }))[0],
        useCallback(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((x, n) => old.deps[n] !== x)) slots[i] = { value: fn, deps }; return slots[i].value; },
        useLayoutEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || !deps || deps.some((x, n) => old.deps?.[n] !== x)) queued.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    };
    react.useEffect = react.useLayoutEffect;
    const exports = load('扩展功能/主题/页签内容过渡.tsx', { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Tabs: 'NativeTabs' },
        'motion/react': { useReducedMotion: () => reduced }, './页签淡变播放器': player,
        './统一页签横条': { useUnifiedTabIndicator() {}, TAB_INDICATOR_BASE_STYLE: { transition: 'none' } },
        './页签内容过渡.module.css': { default: { root: 'root', pane: 'pane', current: 'current', leaving: 'leaving' } } }, { document });
    return { exports, document, listeners, reduce: value => { reduced = value; }, reset() { slots = []; queued = []; },
        render(name, props) { let tree; do { cursor = 0; queued = []; dirty = false; rendering = true; tree = (typeof name === 'function' ? name : exports[name])(props); rendering = false; } while (dirty); return tree; },
        commit() { queued.splice(0).forEach(fn => fn()); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    };
}
const surfaces = tree => tree.props.children.filter(Boolean);
test('原生播放器双向淡变，从中途透明度改向，取消旧回调且退出保持透明至卸载', async () => {
    const f = element(), p = player.createTabFadePlayer(); let enters = 0, exits = 0;
    p.play(f.node, true, true, false, () => enters++);
    assert.deepEqual(f.animations[0].frames, [{ opacity: 0 }, { opacity: 1 }]);
    f.node.opacity = '.37'; p.play(f.node, false, false, false, () => exits++);
    assert.equal(f.animations[0].cancelled, true);
    assert.deepEqual(f.animations[1].frames, [{ opacity: .37 }, { opacity: 0 }]);
    f.animations[0].complete(); await settle(); assert.equal(enters, 0);
    f.animations[1].complete(); await settle(); assert.equal(exits, 1);
    assert.equal(f.animations[1].cancelled, false, '退出完成保持opacity=0，直到真正卸载，不能闪回');
    p.stop(); assert.equal(f.animations[1].cancelled, true);
});
test('减少动态效果、缺少原生API、动画失败均立即完成，不制造定时等待', async () => {
    for (const kind of ['reduced', 'missing', 'throw']) {
        const f = element(), p = player.createTabFadePlayer(); let done = 0;
        if (kind === 'missing') delete f.node.animate;
        if (kind === 'throw') f.node.animate = () => { throw Error('unsupported'); };
        p.play(f.node, false, false, kind === 'reduced', () => done++);
        assert.equal(done, 1); assert.equal(f.animations.length, 0);
    }
    const f = element(), p = player.createTabFadePlayer(); let done = 0;
    p.play(f.node, false, false, false, () => done++); p.stop(); f.animations[0].complete(); await settle(); assert.equal(done, 0);
});
test('快速切换只保留当前和最近一层退场内容，旧完成回调不能清理新交接', () => {
    const f = fixture();
    const render = key => { const tree = f.render('TabContentTransition', { transitionKey: key, children: '内容-' + key }); f.commit(); return tree; };
    assert.equal(surfaces(render('canvas')).length, 1);
    const old = surfaces(render('assets'))[1].props.onExited;
    for (const key of ['history', 'prompts', 'canvas', 'trash', 'assets', 'trash']) {
        const tree = render(key), panes = surfaces(tree);
        assert.equal(tree.props['data-tab-transition'], key); assert.equal(panes.length, 2);
        assert.equal(panes[0].key, key); assert.equal(panes[0].props.present, true); assert.equal(panes[1].props.present, false);
        assert.notEqual(panes[0].key, panes[1].key);
    }
    old(); assert.equal(surfaces(render('trash')).length, 2);
    surfaces(render('trash'))[1].props.onExited(); assert.equal(surfaces(render('trash')).length, 1);
    assert.equal(surfaces(render('trash'))[0].props.children, '内容-trash'); f.unmount(); assert.equal(f.listeners.size, 0);
});
test('退场层立即inert和aria-hidden，原生动画结束才卸载，减少动态效果也保留最终内容', async () => {
    const f = fixture(), root = f.render('TabContentTransition', { transitionKey: 'a', children: '内容' });
    const Surface = surfaces(root)[0].type; f.reset();
    const dom = element(); let exits = 0;
    let tree = f.render(Surface, { present: true, enter: false, enabled: true, children: '内容', onExited: () => exits++ }); tree.props.ref.current = dom.node; f.commit();
    tree = f.render(Surface, { present: false, enter: false, enabled: true, children: '内容', onExited: () => exits++ }); f.commit();
    assert.equal(tree.props.inert, true); assert.equal(tree.props['aria-hidden'], true); assert.equal(exits, 0);
    dom.animations[0].complete(); await settle(); assert.equal(exits, 1);
    f.unmount(); assert.equal(dom.animations[0].cancelled, true);
});
test('缓存产品隐藏后重新进入淡入，未结束的反向过渡从当前值续接，挂载前空ref不消耗入场', () => {
    const f = fixture(), dom = element(), ref = { current: null };
    const Hook = ({ present, enabled }) => f.exports.useNativeTabFade(ref, present, true, enabled);
    f.render(Hook, { present: true, enabled: false }); f.commit();
    ref.current = dom.node; f.render(Hook, { present: true, enabled: true }); f.commit();
    assert.equal(dom.animations[0].frames[0].opacity, 0);
    dom.node.opacity = '.52'; f.render(Hook, { present: false, enabled: true }); f.commit();
    assert.equal(dom.animations[1].frames[0].opacity, .52);
    f.render(Hook, { present: false, enabled: false }); f.commit();
    f.render(Hook, { present: true, enabled: true }); f.commit();
    assert.equal(dom.animations.at(-1).frames[0].opacity, 0); f.unmount();
});
test('原生Tabs保留表单实例、受控与非受控选择、默认键盘逻辑，离开页签不可交互', () => {
    const f = fixture(), formA = { type: 'Form', value: '未保存的编辑' }, formB = { type: 'Form', value: '另一个编辑' };
    const props = { items: [{ key: 'a', children: formA }, { key: 'b', children: formB }], defaultActiveKey: 'a', onChange() {} };
    let tree = f.render('NativeFadeTabs', props);
    assert.equal(tree.type, 'NativeTabs'); assert.equal(tree.props.animated.tabPane, true);
    assert.equal(tree.props.items[0].children.props.children, formA); assert.equal(tree.props.items[0].children.props.inert, false);
    tree.props.onChange('b'); tree = f.render('NativeFadeTabs', props);
    assert.equal(tree.props.items[0].children.props.inert, true); assert.equal(tree.props.items[0].style.pointerEvents, 'none');
    assert.equal(tree.props.items[1].children.props.children, formB); assert.equal(tree.props.items[1].children.props.inert, false);
    tree = f.render('NativeFadeTabs', { ...props, activeKey: 'a' }); assert.equal(tree.props.items[0].children.props.inert, false);
    f.reduce(true); tree = f.render('NativeFadeTabs', props); assert.deepEqual(tree.props.animated, { inkBar: false, tabPane: false });
});
test('所有已盘点原生和自定义页签均接入双向过渡，产品缓存不以动画结束决定卸载', () => {
    for (const file of ['layout/app-config-modal.tsx', 'layout/model-select-modal.tsx', 'canvas/canvas-plugin-manager-modal.tsx']) {
        const source = read('.运行/3100源/画布副本/web/src/components/' + file);
        assert.match(source, /NativeFadeTabs as Tabs/); assert.doesNotMatch(source, /import \{[^}]*\bTabs\b[^}]*\} from "antd"/);
    }
    for (const file of ['canvas/canvas-side-panel.tsx', 'agent/local-agent-panel.tsx', 'agent/agent-log-view.tsx', 'canvas/canvas-node-hover-toolbar.tsx', 'canvas/canvas-config-node-panel.tsx', 'canvas/canvas-node-prompt-panel.tsx']) {
        assert.match(read('.运行/3100源/画布副本/web/src/components/' + file), /<TabContentTransition transitionKey=/, file);
    }
    const workspace = read('扩展功能/产品/产品工作区.tsx');
    assert.match(workspace, /PRODUCT_CANVAS_IDLE_TIMEOUT_MS/); assert.match(workspace, /fadingOut=\{id === handoff.outgoingId\}/);
    assert.match(read('扩展功能/产品/产品界面边界.tsx'), /useNativeTabFade/);
    assert.doesNotMatch(read('扩展功能/主题/页签淡变播放器.ts'), /requestAnimationFrame|setTimeout|setInterval/);
});
test('设置按钮连续打开关闭，保持已选页签；窗口沿用统一原生动画且不重挂载横条', () => {
    const state = { isConfigOpen: false, configTab: 'software-updates', openConfigDialog: () => { state.isConfigOpen = true; }, setConfigDialogOpen: value => { state.isConfigOpen = value; } };
    const header = load('扩展功能/首页/旧版首页顶栏.tsx', {
        react: { useRef: current => ({ current }) }, 'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { App: { useApp: () => ({ message: {} }) } },
        '../Excel/Excel工作簿选择': { ExcelWorkbookPicker: 'Excel' }, '../产品/顶部产品胶囊': { ProductCapsules: 'Products' },
        '../产品配置/功能开关': { productFeatures: { excel: false } },
        '../存储界面/延迟设置入口': { preloadSettings() {} },
        '../产品/产品回收面板': { ProductTrashEntry: 'Trash' }, '../产品/产品操作': { useProductNavigation: () => ({ busy: false }) },
        '@/components/ui/animated-theme-toggler': { AnimatedThemeToggler: 'Theme' }, '@/stores/use-config-store': { useConfigStore: selector => selector(state) },
        '@/stores/use-theme-store': { useThemeStore: selector => selector({ theme: 'light', setTheme() {} }) }, './旧版顶栏.module.css': { default: {} },
    });
    const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === 'object' ? [node, ...all(node.props?.children)] : [];
    for (const expected of [true, false, true, false, true, false]) {
        const button = all(header.LegacyHomeChrome()).find(node => node.props?.id === 'guan-settings-trigger');
        assert.equal(button.props['aria-haspopup'], 'dialog'); button.props.onClick();
        assert.equal(state.isConfigOpen, expected); assert.equal(state.configTab, 'software-updates');
    }
    const source = read('.运行/3100源/画布副本/web/src/components/layout/app-config-modal.tsx');
    assert.match(source, /triggerId="guan-settings-trigger"/);
    assert.doesNotMatch(source, /transitionName=|maskTransitionName=|afterOpenChange=/);
    assert.doesNotMatch(source, /useSettingsTabBarAlignment|renderTabBar|guan-motion-panel/);
});
