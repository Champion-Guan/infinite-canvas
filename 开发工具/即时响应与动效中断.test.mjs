import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(resolve(root, '.运行/3100源/画布副本/web/package.json'));
const ts = require('typescript');
function load(file, dependencies, globals = {}) {
    const source = readFileSync(resolve(root, file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), `未注入依赖：${id}`);
        return dependencies[id];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}
const jsx = (type, props) => ({ type, props: props || {} });
const springSettings = load('扩展功能/主题/苹果动效.ts', {});
const motion = load('扩展功能/画布交互/视区弹簧动效.ts', {
    react: {}, motion: require('motion'), 'motion/react': {}, '../主题/苹果动效': springSettings, '../主题/可见页面轮询': {},
});
function springFixture() {
    let current = { x: 0, y: 0, k: 1 }, now = 0, sequence = 0;
    const frames = new Map(), events = [], allFrames = new Map(), ref = { current: null };
    const port = {
        frameRef: ref, read: () => current, now: () => now,
        begin: value => events.push(['begin', { ...value }]),
        move: value => { current = value; events.push(['move', { ...value }]); },
        finish: () => events.push(['finish', { ...current }]),
        frame: callback => { const id = ++sequence; frames.set(id, callback); allFrames.set(id, callback); return id; },
        cancel: id => { frames.delete(id); events.push(['cancel', id]); },
    };
    const api = motion.createViewportSpring(port);
    return { ...api, events, frames, allFrames, ref, current: () => current,
        step(ms = 16) { now += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now)); },
        settle() { for (let i = 0; frames.size && i < 160; i++) this.step(); assert.equal(frames.size, 0); },
        replace: value => { current = value; }, now: () => now,
    };
}

test('视区弹簧第一帧即有位移，平移与缩放自然到达目标，结束后不遗留帧循环', () => {
    const f = springFixture(), target = { x: 400, y: -200, k: .35 };
    f.moveTo(target); assert.equal(f.frames.size, 1);
    f.step();
    assert.ok(f.current().x > 0 && f.current().x < target.x);
    assert.ok(f.current().y < 0); assert.ok(f.current().k < 1);
    f.settle();
    assert.deepEqual(f.current(), target); assert.equal(f.ref.current, null);
    assert.equal(f.events.filter(([kind]) => kind === 'finish').length, 1);
});
test('快速反向定位从当前显示值继续并携带速度，不跳回旧起点或被迟到帧覆盖', () => {
    const f = springFixture();
    f.moveTo({ x: 500, y: 200, k: 2 });
    for (let i = 0; i < 5; i++) f.step();
    const presented = { ...f.current() }, oldFrame = f.allFrames.get(f.ref.current);
    const previous = f.events.filter(([kind]) => kind === 'move').at(-2)[1];
    const speed = (presented.x - previous.x) * 1000 / 16;
    f.moveTo({ x: -200, y: -50, k: 1 });
    assert.deepEqual(f.events.filter(([kind]) => kind === 'begin').at(-1)[1], presented);
    const expected = require('motion').spring({ ...springSettings.APPLE_CONTROL_SPRING,
        keyframes: [presented.x, -200], velocity: speed, restDelta: .1, restSpeed: 1 }).next(16).value;
    oldFrame(f.now() + 16);
    assert.deepEqual(f.current(), presented, '被取消的旧帧不能重写视区');
    f.step(); assert.ok(Math.abs(f.current().x - expected) < .000001, '反向时必须继承当前速度');
    f.settle(); assert.deepEqual(f.current(), { x: -200, y: -50, k: 1 });
});
test('手势接管立即停止原弹簧，取消幂等，不强制跳到原目标，迟到回调无效', () => {
    const f = springFixture(); f.moveTo({ x: 900, y: 200, k: 2 }); f.step(48);
    const previous = { ...f.current() }, callback = f.allFrames.get(f.ref.current);
    f.stop(); f.stop();
    assert.equal(f.frames.size, 0); assert.equal(f.ref.current, null); assert.deepEqual(f.current(), previous);
    assert.equal(f.events.filter(([kind]) => kind === 'finish').length, 1);
    const user = { x: 23, y: 27, k: .7 }; f.replace(user); callback(300);
    assert.deepEqual(f.current(), user); assert.equal(f.frames.size, 0);
});
test('减少动态效果直接定位、无异步等待；同值定位不启动动画；无效目标不破坏当前状态', () => {
    const f = springFixture(), target = { x: 50, y: 30, k: 1.1 };
    f.moveTo(target, true); assert.deepEqual(f.current(), target); assert.equal(f.frames.size, 0);
    const count = f.events.length; f.moveTo(target); assert.equal(f.events.length, count);
    for (const bad of [{ ...target, x: NaN }, { ...target, y: Infinity }, { ...target, k: 0 }, { ...target, k: 6 }])
        assert.throws(() => f.moveTo(bad), /目标视区无效/);
    assert.deepEqual(f.current(), target); assert.equal(f.frames.size, 0);
});
test('大距离定位与边界缩放保持有效，结束位置精确且不反复写入', () => {
    for (const k of [.05, 5]) {
        const f = springFixture(), target = { x: -100000, y: 50000, k };
        f.moveTo(target); f.settle();
        assert.deepEqual(f.current(), target);
        assert.ok(f.events.filter(([kind]) => kind === 'move').every(([,value]) => value.k >= .05 && value.k <= 5));
    }
});

test('切走产品、隐藏页面、启用减少动态效果和卸载均取消视区动画，不留后台帧循环', () => {
    for (const reason of ['inactive', 'hidden', 'reduced', 'unmount']) {
        const refs = [], frames = new Map();
        let index = 0, sequence = 0, effect, cleanup;
        let active = true, visible = true, reduced = false;
        const { useViewportSpring } = load('扩展功能/画布交互/视区弹簧动效.ts', {
            react: { useRef(value) { const i = index++; return refs[i] ||= { current: value }; },
                useCallback: fn => fn, useEffect: fn => { effect = fn; } },
            motion: require('motion'), 'motion/react': { useReducedMotion: () => reduced },
            '../主题/苹果动效': springSettings, '../主题/可见页面轮询': { usePageVisible: () => visible },
        }, { requestAnimationFrame: fn => { frames.set(++sequence, fn); return sequence; },
            cancelAnimationFrame: id => frames.delete(id), performance: { now: () => 0 } });
        const viewportRef = { current: { x: 0, y: 0, k: 1 } }, focusAnimRef = { current: null };
        const render = () => {
            index = 0;
            const api = useViewportSpring({ active, viewportRef, focusAnimRef,
                viewportControllerRef: { current: null }, setViewport() {} });
            cleanup?.(); cleanup = effect(); return api;
        };
        const api = render(); api.moveTo({ x: 300, y: 200, k: 2 });
        assert.equal(frames.size, 1);
        if (reason === 'inactive') active = false;
        if (reason === 'hidden') visible = false;
        if (reason === 'reduced') reduced = true;
        if (reason === 'unmount') cleanup();
        else {
            const current = render();
            if (reason === 'inactive' || reason === 'hidden') current.moveTo({ x: 400, y: 100, k: 1 });
        }
        assert.equal(frames.size, 0, reason); assert.equal(focusAnimRef.current, null);
    }
});

function functionInitializer(source, name) {
    const ast = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let result;
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node.initializer.getText(ast);
        ts.forEachChild(node, visit);
    };
    visit(ast); assert.ok(result, name);
    return ts.transpile(`const callback = ${result};`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX });
}
test('侧栏的图片、视频和文本定位均在同次点击执行，预览关闭不再等待180ms', () => {
    const source = readFileSync(resolve(root, '.运行/3100源/画布副本/web/src/components/canvas/canvas-side-panel.tsx'), 'utf8');
    const code = functionInitializer(source, 'activateNode');
    assert.doesNotMatch(code, /setTimeout|focusTimerRef|PRESS_FOCUS_DELAY/);
    const calls = [];
    const activate = new Function('onHoverNode', 'onFocusNode', code + ';return callback;')(
        value => calls.push(['hover', value]), value => calls.push(['focus', value]));
    for (const type of ['image', 'video', 'text']) {
        activate({ id: type, type, metadata: { content: 'preview' } });
        assert.deepEqual(calls.splice(0), [['hover', null], ['focus', type]]);
    }
});

test('滚轮及捕获阶段指针按下先交还手动控制，层内卡片停止冒泡也不阻止接管', () => {
    const calls = [], timers = new Map();
    const { InfiniteCanvas } = load('.运行/3100源/画布副本/web/src/components/canvas/infinite-canvas.tsx', {
        react: { useEffect() {}, useLayoutEffect: fn => fn(), useRef: current => ({ current }), useState: value => [value, () => {}] },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        '@/扩展功能/画布交互/快捷键边界': {},
        '@/扩展功能/产品/产品界面边界': { useProductActive: () => true },
        '@/扩展功能/画布布局/画布平移调度': { createCanvasPanScheduler: () => ({
            begin() { calls.push('begin'); }, move() { calls.push('move'); }, flush() {}, dispose() {},
        }) },
        '@/lib/canvas-theme': { canvasThemes: { light: { canvas: {} } } },
        '@/stores/use-theme-store': { useThemeStore: select => select({ theme: 'light' }) },
    }, { Element: class {}, setTimeout: fn => { timers.set(1, fn); return 1; }, clearTimeout: id => timers.delete(id) });
    const tree = InfiniteCanvas({ containerRef: { current: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
        viewport: { x: 0, y: 0, k: 1 }, tool: 'pan', onViewportChange() {}, onManualViewportStart: () => calls.push('manual'), children: null });
    tree.props.onPointerDownCapture({}); assert.deepEqual(calls.splice(0), ['manual']);
    tree.props.onWheel({ target: null, deltaY: 10, clientX: 20, clientY: 30 });
    assert.deepEqual(calls.splice(0), ['manual', 'begin', 'move']);
});

test('滑块几何不走补间动画，进度只动画宽度；通用控件不常驻will-change层', () => {
    const source = readFileSync(resolve(root, '.运行/3100源/画布副本/web/src/styles/globals.css'), 'utf8');
    const postcss = createRequire(require.resolve('vite'))('postcss');
    let sliderRule = false, progressRule = false;
    postcss.parse(source).walkRules(rule => {
        if (rule.selector.replace(/\s/g, '') === '.ant-slider-track,.ant-slider-handle') {
            sliderRule = true;
            assert.doesNotMatch(rule.nodes.find(item => item.prop === 'transition').value, /\ball\b|width|height|left|right|translate|transform/);
        }
        if (rule.selector === '.ant-progress-bg' && rule.nodes.some(item => item.prop === 'transition')) {
            progressRule = true;
            assert.doesNotMatch(rule.nodes.find(item => item.prop === 'transition').value, /\ball\b/);
        }
        if (['.guan-motion-interactive', '.guan-touch-follow'].includes(rule.selector))
            assert.ok(!rule.nodes.some(item => item.prop === 'will-change' && item.value !== 'auto'));
    });
    assert.ok(sliderRule && progressRule);
});

test('实际画布定位、复位和新增卡片共用弹簧，手动缩放及历史回放先停止旧动效', () => {
    const source = readFileSync(resolve(root, '.运行/3100源/画布副本/web/src/pages/canvas/project.tsx'), 'utf8');
    assert.ok(source.includes('useViewportSpring({'));
    assert.doesNotMatch(source, /const duration = 450|easeOutCubic|const step = \(now: number\)/);
    assert.ok(functionInitializer(source, 'focusNode').includes('moveFocusViewport(target)'));
    assert.match(functionInitializer(source, 'resetViewport'), /moveFocusViewport/);
    assert.match(functionInitializer(source, 'finishViewportInteraction'), /stopFocusMotion/);
    assert.match(functionInitializer(source, 'applyHistory'), /stopFocusMotion/);
});

test('常驻产品侧栏的页签指示器按本地ref及产品身份隔离，隐藏产品不驱动横条', () => {
    const source = readFileSync(resolve(root, '.运行/3100源/画布副本/web/src/components/canvas/canvas-side-panel.tsx'), 'utf8');
    const ast = ts.createSourceFile('side-panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let owned = false, localRef = false, markers = 0;
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'tabsRef') localRef = node.initializer?.getText(ast).includes('useRef');
        if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useUnifiedTabIndicator') {
            owned = node.arguments[0]?.getText(ast) === 'tabsRef' && node.arguments[1]?.getText(ast).includes('projectId')
                && node.arguments[2]?.getText(ast).includes('productActive && panelOpen');
        }
        if (ts.isJsxSelfClosingElement(node) && node.attributes.properties.some(attribute => attribute.name?.getText(ast) === 'data-unified-tab-indicator')) markers++;
        ts.forEachChild(node, visit);
    };
    visit(ast); assert.ok(owned && localRef); assert.equal(markers, 1);
    assert.ok(!source.includes('layoutId="sidePanelTabIndicator"'));
    assert.match(readFileSync(resolve(root, '扩展功能/主题/统一页签横条.ts'), 'utf8'), /const player = useRef/);
});
