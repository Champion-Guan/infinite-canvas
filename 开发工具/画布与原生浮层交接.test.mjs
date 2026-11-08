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
    let cursor = 0, active = true, reduced = false, focused = 0;
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
        'motion/react': { useReducedMotion: () => reduced },
        './产品界面边界': { useProductActive: () => active }, '../产品/产品界面边界': { useProductActive: () => active },
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
            } else node.props.children.props.ref.current = { querySelector: () => ({ focus() { focused++; } }) };
            return node; },
        commit() { queued.splice(0).forEach(run => run()); },
        active(value) { active = value; }, reduce(value) { reduced = value; },
        animations, focused: () => focused,
        timers, showLoading() { const work = [...timers.values()]; timers.clear(); work.forEach(run => run()); },
        unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    };
}

test('慢加载显示同色骨架，实际画布一旦就绪立即移除骨架，不延迟覆盖新画面', async () => {
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
    assert.equal(node.props.children[1], null, 'ready与移除骨架在同一渲染，不等动画结束');
    assert.deepEqual(f.animations[0].frames, [{ opacity: 0 }, { opacity: 1 }]);
    assert.equal(f.animations.length, 1);
    assert.equal(f.animations[0].options.duration, 200);
    f.animations.forEach(animation => animation.complete()); await settle();
    node = f.render('CanvasArrival', props);
    assert.equal(node.props.children[1], null);
    assert.equal(node.props['data-canvas-arrival'], 'ready');
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

test('生成设置由原生Popover控制开关与退场，切产品关闭，Escape还原按钮焦点', () => {
    const f = fixture('主题/原生设置浮层.tsx'), changes = [];
    const props = { label: '图像生成设置', theme: { toolbar: { panel: '#fff' }, node: { text: '#111' } },
        onOpenChange: open => changes.push(open), children: jsx('Button', {}), content: '设置字段' };
    let node = f.render('NativeSettingsPopover', props); f.commit();
    assert.equal(node.type, 'NativePopover');
    assert.equal(node.props.open, false);
    node.props.onOpenChange(true);
    node = f.render('NativeSettingsPopover', props); f.commit();
    assert.equal(node.props.open, true);
    assert.equal(node.props.content.props.children, '设置字段');
    assert.equal(node.props.children.props.children.props['aria-expanded'], true);
    let prevented = false;
    node.props.content.props.onKeyDown({ key: 'Escape', nativeEvent: {}, target: { closest: () => null },
        preventDefault() { prevented = true; }, stopPropagation() {} });
    assert.equal(prevented, true); assert.equal(f.focused(), 1);
    node.props.onOpenChange(true); f.render('NativeSettingsPopover', props); f.commit();
    f.active(false); f.render('NativeSettingsPopover', props); f.commit();
    assert.equal(f.render('NativeSettingsPopover', props).props.open, false);
    assert.deepEqual(changes, [true, false, true, false]);
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
