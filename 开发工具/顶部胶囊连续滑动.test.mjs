import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json'));
const ts = require('typescript');
const { spring } = require('motion');
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const all = value => Array.isArray(value) ? value.flatMap(all) : value && typeof value === 'object'
    ? [value, ...all(value.props?.children)] : [];
const source = readFileSync('扩展功能/产品/顶部产品胶囊.tsx', 'utf8');
const slideSource = readFileSync('扩展功能/产品/胶囊滑动动效.ts', 'utf8');

function fixture(reduced = false) {
    const slots = [], effects = [], calls = [], focused = [], observers = [], scrolls = [], writes = [], passive = [], frames = new Map();
    const scrollEvents = new EventTarget();
    let now = 0, frameId = 0, nativeCalls = 0;
    let cursor = 0, active = 'A', owner = 'book', busy = false, fail = false, taskStatus = 'idle', node;
    const projects = ['A', 'B', 'C'].map((id, index) => ({ id, title: id, createdAt: String(index), nodes: [], connections: [] }));
    class Element {
        constructor(id) { this.dataset = { productId: id }; this.id = id; this.parentElement = {
            offsetLeft: projects.findIndex(item => item.id === id) * 133, offsetWidth: 128, offsetHeight: 36,
        }; }
        getAttribute(name) { return name === 'role' ? 'tab' : null; }
        focus(options) { focused.push({ id: this.id, options }); }
        getBoundingClientRect() { return { left: this.parentElement.offsetLeft - container.scrollLeft, right: this.parentElement.offsetLeft + 128 - container.scrollLeft }; }
    }
    const container = {
        clientWidth: 265, scrollWidth: 394, scrollLeft: 0, dataset: {}, style: { setProperty(key, value) { this[key] = value; } },
        querySelector: () => tabs.find(tab => tab.id === active),
        querySelectorAll: () => tabs,
        getBoundingClientRect: () => ({ left: 0, right: container.clientWidth }),
        addEventListener: (...args) => scrollEvents.addEventListener(...args),
        removeEventListener: (...args) => scrollEvents.removeEventListener(...args),
        scrollTo(options) { scrolls.push(options); this.scrollLeft = options.left; scrollEvents.dispatchEvent(new Event('scroll')); },
    };
    const tabs = projects.map(project => new Element(project.id));
    const content = { offsetLeft: 1 };
    const indicator = {
        style: { transform: 'none', width: '0px', height: '36px' },
        offsetWidth: 0, playback: null,
        animate(keyframes, options) {
            nativeCalls++;
            let done, fail, settled = false;
            const finished = new Promise((resolve, reject) => { done = resolve; fail = reject; });
            const playback = { id: ++frameId, keyframes, options, currentTime: 0, finished, cancelled: false,
                cancel() { this.cancelled = true; frames.delete(this.id); if (!settled) { settled = true; fail(Error('cancelled')); } },
                advance(ms) { this.currentTime = Math.min(this.options.duration, this.currentTime + ms);
                    if (this.currentTime === this.options.duration) { frames.delete(this.id); if (!settled) { settled = true; done(); } } },
            };
            this.playback = playback; frames.set(playback.id, playback);
            return playback;
        },
    };
    const matrix = transform => {
        const x = Number(transform?.match(/translateX\(([-\d.e]+)px\)/)?.[1] || 0);
        const a = Number(transform?.match(/scaleX\(([-\d.e]+)\)/)?.[1] ?? 1);
        return { m41: x, a };
    };
    const computed = () => {
        const animation = indicator.playback;
        if (!animation || animation.cancelled) return matrix(indicator.style.transform);
        const progress = animation.currentTime / animation.options.duration * (animation.keyframes.length - 1);
        const index = Math.min(animation.keyframes.length - 2, Math.floor(progress));
        const from = matrix(animation.keyframes[index].transform), to = matrix(animation.keyframes[index + 1].transform), fraction = progress - index;
        return { m41: from.m41 + (to.m41 - from.m41) * fraction, a: from.a + (to.a - from.a) * fraction };
    };
    const react = {
        useId: () => 'scoped-navigation',
        useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useMemo(operation) { const i = cursor++; if (!(i in slots)) slots[i] = operation(); return slots[i]; },
        useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
        useLayoutEffect: callback => effects.push(callback),
        useEffect: callback => passive.push(callback),
        useSyncExternalStore: (_subscribe, read) => read(),
    };
    const imports = {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: select => select({ projects }) },
        '../本机存储/上游浏览器存储桥': { sqlitePreferences: { getItem: () => null, setItem: (...args) => writes.push(args) }, storageStatus: () => ({ state: 'ready' }) },
        '../存储界面/保存错误通知': { reportSaveFailure() {} },
        '../主题/状态详情': { StatusDetails: 'StatusDetails' },
        '../Excel/Excel产品归属': { orderedWorkbookProjects: items => items, visibleWorkbookId: () => owner },
        './产品导航范围': { navigationOwner: () => owner, navigationProducts: state => state.projects },
        '../产品配置/功能开关': { productFeatures: { excel: true } },
        './产品规则': { orderedProducts: items => items },
        './产品操作': { useProductNavigation: () => ({ activeId: active, busy, selectProduct: async id => { calls.push(id); if (fail) throw Error('合成切换失败'); active = id; } }) },
        './产品任务摘要.js': { canvasTaskSummary: () => ({ status: taskStatus }) },
        './旧版产品显示名.js': { productDisplayName: project => project.title },
        './旧版产品胶囊状态.js': { readCanvasCapsuleStatus: () => taskStatus },
        './产品胶囊.module.css': { default: { root: 'root', track: 'track', indicator: 'indicator', error: 'error' } },
        './产品回收面板': { ProductDeleteDialog: 'Dialog', ProductTrashIcon: 'Trash' },
        'motion/react': { AnimatePresence: 'Presence', motion: { button: 'motion.button' }, useReducedMotion: () => reduced },
        motion: { spring },
        '../主题/苹果动效': { APPLE_CONTROL_SPRING: { type: 'spring' } },
        '../主题/苹果交互按钮': { AppleActionButton: 'ActionButton' },
        'lucide-react': { ChevronLeft: 'ChevronLeft', ChevronRight: 'ChevronRight' },
    };
    const document = new EventTarget(); document.visibilityState = 'visible';
    const load = codeSource => {
        const code = ts.transpileModule(codeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
        const module = { exports: {} };
        new Function('require', 'module', 'exports', 'document', 'HTMLElement', 'ResizeObserver', 'getComputedStyle', 'DOMMatrixReadOnly', code)(
        id => { assert.ok(Object.hasOwn(imports, id), id); return imports[id]; }, module, module.exports, document, Element, class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe() {}
            disconnect() { this.disconnected = true; }
        }, () => { const value = computed(); return { width: indicator.style.width, transform: `translateX(${value.m41}px) scaleX(${value.a})` }; },
        class { constructor(transform) { Object.assign(this, matrix(transform)); } });
        return module.exports;
    };
    const slide = load(slideSource); imports['./胶囊滑动动效'] = slide;
    imports['./胶囊鼠标拖动'] = { useCapsuleMouseDrag() {} };
    const module = load(source);
    const render = () => {
        cursor = 0; effects.length = 0;
        node = module.ProductCapsules();
        all(node).find(item => item.props.role === 'tablist').props.ref.current = container;
        all(node).find(item => item.props.className === 'track').props.ref.current = content;
        all(node).find(item => item.props['data-product-indicator']).props.ref.current = indicator;
        return node;
    };
    const step = milliseconds => {
        now += milliseconds;
        [...frames.values()].forEach(playback => playback.advance(milliseconds));
    };
    return {
        render, container, tabs, calls, focused, scrolls, observers, writes, frames, slide, document, step,
        position: () => computed().m41, nativeCalls: () => nativeCalls,
        finish() { for (let i = 0; frames.size && i < 150; i++) step(16); assert.equal(frames.size, 0); },
        select: id => { active = id; }, workbook: value => { owner = value; }, block: value => { busy = value; }, fail: () => { fail = true; },
        status: value => { taskStatus = value; },
        elements: () => all(node), tab: id => all(node).find(item => item.props.role === 'tab' && item.props['data-product-id'] === id),
        indicator: () => all(node).find(item => item.props['data-product-indicator']),
        nav: () => all(node).find(item => item.props.role === 'tablist'),
        hint: side => all(node).find(item => item.props['data-capsule-location'] === side),
        scroll: left => { container.scrollLeft = left; scrollEvents.dispatchEvent(new Event('scroll')); },
        effects: () => effects.map(effect => effect()),
        passive: () => passive.map(effect => effect()),
    };
}

test('单一选中背景使用浏览器动画，连续点选从当前呈现位置转向最新目标，不新增保存', async () => {
    const f = fixture(); f.render(); f.effects();
    const element = f.indicator().props.ref.current;
    assert.equal(f.indicator().props['data-product-indicator'], 'A');
    f.tab('B').props.onClick({ detail: 0 }); f.render(); f.effects(); f.step(64);
    assert.equal(f.indicator().props.ref.current, element);
    assert.ok(f.position() > 0 && f.position() < 133, '必须存在中间位移');
    assert.equal(f.indicator().props['data-product-indicator'], 'B');
    const inFlight = f.position();
    f.tab('C').props.onClick({ detail: 0 }); f.render(); f.effects();
    assert.ok(Math.abs(f.position() - inFlight) < .001, '换目标不能跳到旧终点或新起点');
    assert.equal(f.indicator().props['data-product-indicator'], 'C');
    assert.deepEqual(f.calls, ['B', 'C']);
    assert.equal(f.elements().filter(item => item.props['data-product-indicator']).length, 1);
    assert.equal(f.indicator().props['aria-hidden'], 'true');
    assert.equal(f.frames.size, 1, '只保留一条动画，旧目标不继续执行');
    assert.equal(f.container.dataset.capsuleSliding, 'true');
    f.finish(); assert.equal(f.position(), 266);
    await Promise.resolve();
    assert.equal(f.container.dataset.capsuleSliding, 'false');
    assert.equal(f.nativeCalls(), 2);
    assert.deepEqual(f.writes, []);
});

test('原生动画被外部取消时落到当前目标并交回实体底色，旧取消不会覆盖连续切换', async () => {
    const f = fixture(); f.render(); f.effects();
    f.select('B'); f.render(); f.effects(); f.step(48);
    const old = [...f.frames.values()][0];
    f.select('C'); f.render(); f.effects();
    await Promise.resolve();
    assert.equal(old.cancelled, true);
    assert.equal(f.container.dataset.capsuleSliding, 'true');
    assert.equal(f.frames.size, 1);
    const current = [...f.frames.values()][0];
    current.cancel();
    await Promise.resolve();
    assert.equal(f.position(), 266);
    assert.equal(f.container.dataset.capsuleSliding, 'false');
    assert.equal(f.frames.size, 0);
});

test('浏览器播放失败时仍显示当前实体胶囊，减少动态效果不进入滑动透明态', () => {
    const f = fixture(); f.render(); f.effects();
    f.indicator().props.ref.current.animate = () => { throw Error('synthetic playback unavailable'); };
    f.select('C'); f.render();
    assert.doesNotThrow(() => f.effects());
    assert.equal(f.position(), 266);
    assert.equal(f.container.dataset.capsuleSliding, 'false');
    const reduced = fixture(true); reduced.render(); reduced.effects();
    reduced.select('C'); reduced.render(); reduced.effects();
    assert.equal(reduced.container.dataset.capsuleSliding, 'false');
});

test('任务状态改变和边缘定位提示使用同一状态，不重新进入几何滑动或遗留透明态', () => {
    const f = fixture(); f.select('C'); f.render(); f.effects();
    for (const status of ['loading', 'success', 'error', 'idle', 'success']) {
        f.status(status); f.render();
        assert.equal(f.indicator().props['data-status'], status);
        assert.match(f.tab('C').props.className, new RegExp(`capsule-${status} `));
        assert.equal(f.container.dataset.capsuleSliding, 'false');
        assert.equal(f.frames.size, 0);
        f.scroll(0); f.render();
        assert.equal(all(f.hint('right')).find(item => item.type === 'ActionButton').props['data-status'], status);
        all(f.hint('right')).find(item => item.type === 'ActionButton').props.onClick(); f.render();
        assert.equal(f.container.dataset.capsuleSliding, 'false');
    }
    assert.deepEqual(f.calls, []);
});

test('按距离调整实际Motion弹簧速度与阻尼：远距离更快，回弹更少且能收敛', () => {
    const f = fixture(); f.render();
    const results = [133, 798].map(distance => {
        const config = f.slide.capsuleSlideSpring(distance, 128), animation = spring({ ...config, keyframes: [0, distance] }), values = [];
        for (let time = 0; time <= 1200; time += 8) values.push(animation.next(time).value);
        assert.ok(Math.abs(values.at(-1) - distance) < .5);
        return { config, overshoot: Math.max(...values) - distance, earlyTravel: values[12] };
    });
    assert.ok(results[1].config.stiffness > results[0].config.stiffness);
    assert.ok(results[1].config.damping > results[0].config.damping);
    assert.ok(results[1].earlyTravel > results[0].earlyTravel * 5);
    assert.ok(results[0].overshoot > .2 && results[0].overshoot < 5, '近距离轻微回弹');
    assert.ok(results[1].overshoot < results[0].overshoot, '远距离收敛弹性，避免大幅过冲');
});

test('切换后只提交一次原生关键帧，后续时间推进不再调用JS逐帧样式写入', () => {
    const f = fixture(); f.render(); f.effects();
    f.select('C'); f.render(); f.effects();
    const element = f.indicator().props.ref.current, base = { ...element.style };
    const playback = [...f.frames.values()][0];
    assert.equal(playback.options.fill, 'both');
    assert.equal(playback.options.easing, 'linear');
    assert.ok(playback.keyframes.length > 10);
    f.step(120);
    assert.ok(f.position() > 0 && f.position() < 266);
    assert.deepEqual(element.style, base, '只推进浏览器时间，JS不写中间样式');
    assert.equal(f.nativeCalls(), 1);
    assert.doesNotMatch(slideSource, /requestAnimationFrame|cancelAnimationFrame|console\.debug/);
});

test('Excel切换直接定位新列表，旧动画被取消；滚动目标被限制在导航区域', () => {
    const f = fixture(); f.render(); f.effects().forEach(cleanup => cleanup?.());
    f.workbook('other-book'); f.select('C'); f.render(); f.effects();
    assert.equal(f.position(), 266);
    assert.equal(f.frames.size, 0);
    assert.deepEqual(f.scrolls.at(-1), { left: 129, behavior: 'instant' });
    assert.equal(f.container.scrollLeft + f.container.clientWidth, f.container.scrollWidth);
    assert.ok(f.observers[0].disconnected);
});

test('同工作簿切换自动揭示目标，尺寸不变不打断平滑滚动，卸载移除观察器', () => {
    const f = fixture(); f.render(); f.effects();
    f.select('C'); f.render(); const cleanups = f.effects();
    assert.equal(f.scrolls.at(-1).behavior, 'smooth');
    const count = f.scrolls.length;
    f.observers.at(-1).callback();
    assert.equal(f.scrolls.length, count, 'ResizeObserver首次通知不能取消刚开始的滚动');
    f.container.clientWidth = 200;
    f.observers.at(-1).callback();
    assert.equal(f.scrolls.at(-1).behavior, 'instant');
    cleanups.forEach(cleanup => cleanup?.());
    assert.ok(f.observers.at(-1).disconnected);
});

test('点击完全可见的产品仍滚至区域中心，左右切换以最新产品为准且首尾不越界', () => {
    const f = fixture(); f.render(); f.effects();
    f.tab('B').props.onClick(); f.render(); f.effects();
    assert.deepEqual(f.scrolls.at(-1), { left: 65.5, behavior: 'smooth' });
    assert.equal(f.tabs[1].parentElement.offsetLeft + 1 + 64 - f.container.scrollLeft, f.container.clientWidth / 2);
    f.tab('C').props.onClick(); f.render(); f.effects();
    assert.deepEqual(f.scrolls.at(-1), { left: 129, behavior: 'smooth' });
    f.tab('B').props.onClick(); f.render(); f.effects();
    assert.deepEqual(f.scrolls.at(-1), { left: 65.5, behavior: 'smooth' });
    f.tab('A').props.onClick(); f.render(); f.effects();
    assert.deepEqual(f.scrolls.at(-1), { left: 0, behavior: 'smooth' });
    assert.deepEqual(f.calls, ['B', 'C', 'B', 'A']);
    assert.deepEqual(f.writes, []);
});

test('自由浏览不自动拉回，显式定位才重新居中，减少动态效果直接完成定位', () => {
    const f = fixture(true); f.select('B'); f.render(); f.effects();
    assert.deepEqual(f.scrolls.at(-1), { left: 65.5, behavior: 'instant' });
    const count = f.scrolls.length;
    f.scroll(0); f.render();
    assert.equal(f.container.scrollLeft, 0);
    assert.equal(f.scrolls.length, count);
    f.observers.at(-1).callback();
    assert.equal(f.scrolls.length, count, '尺寸未变化的观测不干预自由浏览');
    // 模拟更窄导航使当前项离屏，原边缘入口也使用相同中心定位。
    f.container.clientWidth = 100; f.scroll(0); f.render();
    all(f.hint('right')).find(item => item.type === 'ActionButton').props.onClick();
    assert.deepEqual(f.scrolls.at(-1), { left: 148, behavior: 'instant' });
    assert.deepEqual(f.focused.at(-1), { id: 'B', options: { preventScroll: true } });
    assert.deepEqual(f.calls, []);
});

test('减少动态效果时选中状态即时更新，不共享位移动画；箭头切换不让删除按钮参与导航', () => {
    const f = fixture(true); f.render(); f.effects();
    assert.equal(f.frames.size, 0);
    assert.equal(f.tab('A').props.tabIndex, 0); assert.equal(f.tab('B').props.tabIndex, -1);
    let prevented = false;
    f.nav().props.onKeyDown({ target: f.tabs[0], key: 'End', preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.deepEqual(f.calls, ['C']);
    f.render(); f.effects();
    assert.equal(f.scrolls.at(-1).behavior, 'instant');
    assert.equal(f.position(), 266);
    assert.equal(f.frames.size, 0);
    assert.deepEqual(f.focused[0], { id: 'C', options: { preventScroll: true } });
    f.nav().props.onKeyDown({ target: { getAttribute: () => null }, key: 'Home' });
    assert.deepEqual(f.calls, ['C']);
    f.block(true); f.render();
    f.nav().props.onKeyDown({ target: f.tabs[2], key: 'Home' });
    assert.deepEqual(f.calls, ['C']);
});

test('页面隐藏结束当前动画；卸载取消动画和监听，不在后台继续驱动', () => {
    const f = fixture(); f.render(); f.effects(); const cleanups = f.passive();
    f.select('C'); f.render(); f.effects(); f.step(32);
    assert.equal(f.frames.size, 1);
    f.document.visibilityState = 'hidden'; f.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(f.frames.size, 0); assert.equal(f.position(), 266);
    f.select('A'); f.render(); f.effects();
    cleanups.forEach(cleanup => cleanup?.());
    assert.equal(f.frames.size, 0);
});

test('失败切换保留原选中背景，错误可见；CSS取消浏览器快照并保留局部滚动裁剪', async () => {
    const f = fixture(); f.render(); f.fail();
    f.tab('B').props.onClick({ detail: 0 }); await Promise.resolve(); await Promise.resolve(); f.render();
    assert.equal(f.indicator().props['data-product-indicator'], 'A');
    assert.ok(f.elements().some(item => item.type === 'StatusDetails' && item.props.failed));
    assert.ok(f.elements().some(item => item.type === 'p' && item.props.children === '合成切换失败'));
    const css = readFileSync('扩展功能/产品/产品胶囊.module.css', 'utf8');
    assert.match(css, /overflow-x: auto/);
    assert.match(css, /\.guan-dc-product-nav \*\)[\s\S]*?view-transition-name: none/);
    assert.doesNotMatch(source, /guan-apple-action|guan-shared-product-capsule/);
    assert.doesNotMatch(css, /view-transition-name: guan-active-product-capsule/);
});

test('产品通过click切换，按下阶段保留给横向拖动判定，连续点击以最新目标为准', () => {
    const f = fixture(); f.render(); f.effects();
    assert.equal(f.tab('B').props.onPointerDown, undefined);
    assert.deepEqual(f.calls, []);
    f.tab('B').props.onClick({ detail: 1 });
    assert.deepEqual(f.calls, ['B']);
    f.tab('C').props.onClick({ detail: 1 }); f.render(); f.effects();
    f.tab('A').props.onClick({ detail: 1 }); f.render(); f.effects();
    assert.deepEqual(f.calls, ['B', 'C', 'A']);
    assert.equal(f.indicator().props['data-product-indicator'], 'A');
});

test('触摸滑动、右键、非主指针和禁用不在按下时切换，键盘及辅助点击保留', () => {
    const f = fixture(); f.render();
    assert.equal(f.tab('B').props.onPointerDown, undefined);
    assert.deepEqual(f.calls, []);
    f.tab('B').props.onClick({ detail: 1 }); assert.deepEqual(f.calls, ['B']);
    f.render(); f.tab('C').props.onClick({ detail: 0 }); assert.deepEqual(f.calls, ['B', 'C']);
    f.block(true); f.render(); f.tab('A').props.onClick({ detail: 0 });
    assert.deepEqual(f.calls, ['B', 'C']);
});

test('当前胶囊在左右边界之外或部分裁剪时提供正确方向，忽略亚像素与无法完全容纳的胶囊', () => {
    const { capsuleOverflowDirection: direction } = fixture().slide;
    assert.equal(direction({ x: 0, width: 128 }, 129, 265), 'left');
    assert.equal(direction({ x: 266, width: 128 }, 0, 265), 'right');
    assert.equal(direction({ x: 0, width: 128 }, 10, 265), 'left');
    assert.equal(direction({ x: 150, width: 128 }, 0, 265), 'right');
    assert.equal(direction({ x: 0, width: 128 }, .5, 265), null);
    assert.equal(direction({ x: 0, width: 128 }, 0, 60), null);
    assert.equal(direction({ x: 266, width: 128 }, 0, 60), 'right');
    assert.equal(direction({ x: 0, width: 128 }, 130, 60), 'left');
    assert.equal(direction(null, 0, 265), null);
    assert.equal(direction({ x: 0, width: 128 }, 0, 0), null);
});

test('自由滚走当前产品时只显示对应边缘入口，点击定位不切换、不落盘，交还当前页签焦点', () => {
    const f = fixture(); f.render(); f.effects();
    f.scroll(129); f.render();
    assert.equal(f.hint('left').props['data-visible'], true);
    assert.equal(f.hint('right').props.inert, true);
    assert.ok(all(f.nav()).includes(f.hint('left')), '提示必须留在同一原生滚动区，保留提示上方的触控板手势');
    const action = all(f.hint('left')).find(item => item.type === 'ActionButton');
    assert.match(action.props['aria-label'], /当前产品在左侧：A/);
    action.props.onClick(); f.render();
    assert.deepEqual(f.scrolls.at(-1), { left: 0, behavior: 'smooth' });
    assert.deepEqual(f.focused.at(-1), { id: 'A', options: { preventScroll: true } });
    assert.equal(f.hint('left').props['aria-hidden'], true);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.writes, []);
});

test('当前产品位于右侧时可返回，减少动态效果直接定位，重新进入可视区域即退出提示', () => {
    const f = fixture(true); f.select('C'); f.render(); f.effects();
    f.scroll(0); f.render();
    assert.equal(f.hint('right').props['data-visible'], true);
    assert.equal(f.hint('left').props['data-visible'], false);
    all(f.hint('right')).find(item => item.type === 'ActionButton').props.onClick(); f.render();
    assert.deepEqual(f.scrolls.at(-1), { left: 129, behavior: 'instant' });
    assert.equal(f.hint('right').props.inert, true);
    assert.deepEqual(f.calls, []);
});

test('连续滑动跨过可见边界时不改选中产品，卸载移除滚动监听并使旧定位回调失效', () => {
    const f = fixture(); f.select('B'); f.render(); const cleanups = f.effects();
    f.scroll(129); f.render();
    assert.equal(f.hint('left').props['data-visible'], false);
    assert.equal(f.hint('right').props['data-visible'], false);
    f.scroll(0); f.container.clientWidth = 200; f.scroll(0); f.render();
    assert.equal(f.hint('right').props['data-visible'], true);
    const stale = all(f.hint('right')).find(item => item.type === 'ActionButton').props.onClick;
    cleanups.forEach(cleanup => cleanup?.());
    f.scroll(129); f.render();
    assert.equal(f.hint('right').props['data-visible'], true, '卸载后的滚动不能继续更新状态');
    const scrollCount = f.scrolls.length;
    stale();
    assert.equal(f.scrolls.length, scrollCount);
    assert.deepEqual(f.calls, []);
});

test('当前胶囊临近边缘时黑色提示连续淡出，反向滚动从当前透明度返回，不改业务选择', () => {
    const f = fixture(); f.render(); f.effects();
    const values = [];
    for (const offset of [80, 50, 20, 3, 0]) {
        f.scroll(offset);
        values.push(Number(f.container.style['--capsule-edge-opacity']));
    }
    assert.equal(values[0], 1);
    assert.equal(values.at(-1), 0);
    for (let index = 1; index < values.length; index++) assert.ok(values[index] < values[index - 1]);
    f.scroll(20);
    assert.ok(Number(f.container.style['--capsule-edge-opacity']) > 0);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.writes, []);
});
