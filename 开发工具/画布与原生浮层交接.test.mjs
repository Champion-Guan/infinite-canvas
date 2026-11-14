import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const jsx = (type, props) => ({ type, props: props || {} });
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(file) {
    const slots = [], queued = [], animations = [], timers = new Map();
    let timerId = 0;
    let cursor = 0, active = true, reduced = false, focused = 0, startup = false;
    const hooks = {
        useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
        useLayoutEffect(callback, deps) { const i = cursor++; const old = slots[i];
            if (!old || deps.some((value, index) => old.deps[index] !== value)) queued.push(() => {
                old?.cleanup?.(); slots[i] = { deps, cleanup: callback() };
            }); },
        cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }),
    };
    hooks.useEffect = hooks.useLayoutEffect;
    const dependencies = { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
        'motion/react': { useReducedMotion: () => reduced, AnimatePresence: 'Presence', motion: { div: 'AnimatedDiv' }, useIsPresent: () => true },
        './产品界面边界': { useProductActive: () => active }, '../产品/产品界面边界': { useProductActive: () => active, createProductPortal: node => node },
        './原生可关闭浮层': { OutsidePanelScope: 'Scope', useOutsidePanel: () => ({ layer: {} }) },
        '../画布交互/设置浮层稳定定位': { positionSettingsPanel: () => () => {} },
        './苹果动效': { APPLE_POPOVER_TRANSITION: { duration: .22, ease: [.22,1,.36,1] } },
        '../主题/页签淡变播放器': { TAB_FADE_DURATION: 180 },
        '../本机存储/启动画面交接.mjs': { finishStartupScreen: () => { const pending = startup; startup = false; return pending; } },
        antd: { Popover: 'NativePopover' }, '@/扩展功能/主题/原生可关闭浮层': { OutsidePopover: 'NativePopover' } };
    const code = ts.transpileModule(readFileSync(new URL('../扩展功能/' + file, import.meta.url), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id];
    }, module, module.exports, callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id));
    const element = () => ({ animate(frames, options) {
        let resolve, reject, ended = false;
        const animation = { frames, options, cancelled: false, finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
            complete() { ended = true; resolve(); }, cancel() { this.cancelled = true; if (!ended) { ended = true; reject(Error('cancelled')); } } };
        animations.push(animation); return animation;
    } });
    const scene = element();
    return {
        render(name, props) { cursor = 0; const node = module.exports[name](props);
            if (name === 'CanvasArrival') {
                node.props.children[0].props.ref.current = scene;
                if (node.props.children[1]) node.props.children[1].props.ref.current = scene;
            } else node.props.children[0].props.ref.current = { querySelector: selector => selector.includes('disabled') ? null : ({ focus() { focused++; } }) };
            return node; },
        panel(component, props) { cursor = 0; slots.length = 0; return component(props); },
        commit() { queued.splice(0).forEach(run => run()); },
        active(value) { active = value; }, reduce(value) { reduced = value; },
        startup(value) { startup = value; },
        animations, focused: () => focused,
        timers, showLoading() { const work = [...timers.values()]; timers.clear(); work.forEach(run => run()); },
        unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    };
}

test('慢加载与就绪画布同步淡变，退场骨架立即让出交互，结束后卸载', async () => {
    const f = fixture('产品/画布进入过渡.tsx');
    const props = { ready: false, background: '#f4f2ed', loading: '原加载画面', children: '实际画布' };
    let node = f.render('CanvasArrival', props); f.commit();
    assert.equal(node.props['data-canvas-arrival'], 'loading');
    assert.equal(node.props.children[0].props.children, null);
    assert.equal(node.props.children[1], null, '快速打开不先闪出整套骨架');
    f.showLoading();
    node = f.render('CanvasArrival', props);
    assert.equal(node.props.children[1].props.children, '原加载画面');
    assert.equal(node.props.children[1].props.style.background, props.background);
    props.ready = true;
    node = f.render('CanvasArrival', props); f.commit();
    assert.equal(node.props.children[0].props.children, '实际画布');
    assert.equal(node.props.children[1].props.inert, true);
    assert.equal(node.props.children[1].props['aria-hidden'], true);
    assert.equal(node.props.children[1].props.style.pointerEvents, 'none');
    assert.deepEqual(f.animations[0].frames, [{ opacity: 0 }, { opacity: 1 }]);
    assert.deepEqual(f.animations[1].frames, [{ opacity: 1 }, { opacity: 0 }]);
    assert.equal(f.animations.length, 2);
    assert.equal(f.animations[0].options.duration, 180);
    f.animations.forEach(animation => animation.complete()); await settle();
    node = f.render('CanvasArrival', props);
    assert.equal(node.props.children[1], null);
    assert.equal(node.props['data-canvas-arrival'], 'ready');
});

test('设置整体含背景一起进退场，不动画化位置，减少动态效果为即时，Escape回到触发器', () => {
    const previous = globalThis.document; globalThis.document = { body: {} };
    try {
        const f = fixture('主题/原生设置浮层.tsx'); let closed = 0, focused = 0;
        const props = { label: '图像生成设置', theme: { toolbar: { panel: '#fff' }, node: { text: '#111' } },
            children: jsx('Button', {}), content: '原字段' };
        let root = f.render('NativeSettingsPopover', props); root.props.children[0].props.onClick();
        root = f.render('NativeSettingsPopover', props);
        const node = root.props.children[1].props.children;
        const panelProps = { ...node.props, close: () => closed++, trigger: { current: { querySelector: () => ({ focus: () => focused++ }) } } };
        const panel = f.panel(node.type, panelProps).props.children;
        assert.deepEqual(panel.props.initial, { opacity: 0, scale: .98 });
        assert.deepEqual(panel.props.animate, { opacity: 1, scale: 1 });
        assert.deepEqual(panel.props.exit, { opacity: 0, scale: .98 });
        assert.equal(panel.props.transition.duration, .22);
        assert.equal(panel.props.style.position, 'fixed');
        assert.equal(panel.props.children.props.children, '原字段');
        let prevented = false;
        panel.props.onKeyDown({ key: 'Escape', nativeEvent: {}, target: { closest: () => null }, preventDefault() { prevented = true; }, stopPropagation() {} });
        assert.equal(prevented, true); assert.equal(closed, 1); assert.equal(focused, 1);
        f.reduce(true);
        const reduced = f.panel(node.type, panelProps).props.children;
        assert.equal(reduced.props.transition.duration, 0); assert.equal(reduced.props.initial.scale, 1);
    } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('切走立即取消旧交接，迟到完成不能影响下一画布；减少动态效果不制造等待', async () => {
    for (const mode of ['inactive', 'reduced']) {
        const f = fixture('产品/画布进入过渡.tsx'), props = { ready: false, background: '#181715', loading: '加载', children: '画布' };
        f.render('CanvasArrival', props); f.commit(); props.ready = true;
        f.render('CanvasArrival', props); f.commit();
        const old = [...f.animations];
        if (mode === 'inactive') f.active(false); else f.reduce(true);
        f.render('CanvasArrival', props); f.commit(); await settle();
        assert.ok(old.every(animation => animation.cancelled));
        assert.equal(f.animations.length, 1);
        assert.equal(f.render('CanvasArrival', props).props.children[1], null);
        f.unmount();
    }
});

test('快速读完取消骨架计时，已就绪画布激活和反复渲染均不重新插入加载层', () => {
    const f = fixture('产品/画布进入过渡.tsx'), props = { ready: false, background: '#f4f2ed', loading: '骨架', children: '画布' };
    f.render('CanvasArrival', props); f.commit();
    assert.equal(f.timers.size, 1);
    props.ready = true;
    f.render('CanvasArrival', props); f.commit();
    assert.equal(f.timers.size, 0);
    f.showLoading();
    for (const active of [false, true, true]) {
        f.active(active);
        const node = f.render('CanvasArrival', props); f.commit();
        assert.equal(node.props.children[1], null);
    }
    f.unmount();
});

test('热画布再激活立即呈现，不重复播放淡入或等待上一次动画结束', async () => {
    const f = fixture('产品/画布进入过渡.tsx');
    const props = { ready: true, background: '#fff', loading: '加载', children: '热画布' };
    f.render('CanvasArrival', props); f.commit();
    f.animations[0].complete(); await settle();
    for (const active of [false, true, false, true]) {
        f.active(active); const node = f.render('CanvasArrival', props); f.commit();
        assert.equal(node.props.children[0].props.children, '热画布'); assert.equal(node.props.children[1], null);
    }
    assert.equal(f.animations.length, 1, '只在首次打开过渡，热切换不额外淡入');
    f.unmount();
});

test('恢复失败保持明确错误和重试区域，不为错误状态运行入场动画', () => {
    const f = fixture('产品/画布进入过渡.tsx');
    const node = f.render('CanvasArrival', { ready: false, failed: true, background: '#181715', loading: '保存失败，重试', children: '不应出现' });
    f.commit();
    assert.equal(node.props['data-canvas-arrival'], 'error');
    assert.equal(node.props['aria-busy'], false);
    assert.equal(node.props.children[1].props.children, '保存失败，重试');
    assert.equal(f.animations.length, 0);
});

test('首次启动只淡出原生启动层，真实画布提交后不从透明度零再入场', () => {
    const f = fixture('产品/画布进入过渡.tsx'); f.startup(true);
    const props = { ready: false, background: '#fff', loading: '骨架', children: '实际画布' };
    f.render('CanvasArrival', props); f.commit();
    f.showLoading(); f.render('CanvasArrival', props); f.commit();
    props.ready = true;
    f.render('CanvasArrival', props); f.commit();
    const ready = f.render('CanvasArrival', props);
    assert.equal(ready.props.children[0].props.children, '实际画布');
    assert.equal(ready.props.children[1], null);
    assert.equal(f.animations.length, 0, '不把启动层淡出与画布淡入串成两次等待');
    f.unmount();
});

test('生成设置单独固定外壳，保持字段，切产品关闭，退场交由Presence', () => {
    const previous = globalThis.document; globalThis.document = { body: {} };
    try {
    const f = fixture('主题/原生设置浮层.tsx'), changes = [];
    const props = { label: '图像生成设置', theme: { toolbar: { panel: '#fff' }, node: { text: '#111' } },
        onOpenChange: open => changes.push(open), children: jsx('Button', {}), content: '设置字段' };
    let node = f.render('NativeSettingsPopover', props); f.commit();
    assert.equal(node.props.children[1].type, 'Presence');
    assert.equal(node.props.children[1].props.children, false);
    node.props.children[0].props.onClick();
    node = f.render('NativeSettingsPopover', props); f.commit();
    assert.equal(node.props.children[1].props.children.props.children, '设置字段');
    assert.equal(node.props.children[0].props.children.props['aria-expanded'], true);
    f.active(false); f.render('NativeSettingsPopover', props); f.commit();
    assert.equal(f.render('NativeSettingsPopover', props).props.children[1].props.children, false);
    assert.deepEqual(changes, [true, false]);
    } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('总览、图片详情、设置、回收站及图片编辑共用原生Modal入口，不禁用遮罩过渡', () => {
    for (const file of ['生成历史/历史总览面板.tsx', '媒体交付/图片详情面板.tsx', '产品/产品回收面板.tsx', 'Excel/Excel导入面板.tsx']) {
        const source = readFileSync(new URL('../扩展功能/' + file, import.meta.url), 'utf8');
        assert.match(source, /苹果弹窗/);
        assert.doesNotMatch(source, /transitionName=""|maskTransitionName=""|motion\.section/);
    }
    const directory = new URL('../.运行/3100源/画布副本/web/src/', import.meta.url);
    for (const file of ['components/layout/app-config-modal.tsx', 'components/canvas/canvas-node-crop-dialog.tsx',
        'components/canvas/canvas-node-split-dialog.tsx', 'components/canvas/canvas-node-mask-edit-dialog.tsx']) {
        assert.match(readFileSync(new URL(file, directory), 'utf8'), /苹果弹窗/);
    }
    const provider = readFileSync(new URL('../扩展功能/主题/界面动态偏好.tsx', import.meta.url), 'utf8');
    assert.match(provider, /motion: !reducedMotion/);
});
