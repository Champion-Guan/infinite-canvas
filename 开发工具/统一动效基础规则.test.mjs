import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const jsx = (type, props) => ({ type, props: props || {} });
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === 'object' ? [node, ...all(node.props?.children)] : [];
function load(file, dependencies, globals = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports, ...Object.values(globals));
    return module.exports;
}
function fixture(native = false) {
    const slots = [], queue = [], movements = [], animations = [], observers = [], mutations = [], listeners = new Set();
    let cursor = 0, active = 'a', stops = 0, factories = 0;
    const react = {
        useRef(value) { const i = cursor++; slots[i] ||= { current: value }; return slots[i]; },
        useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((x, n) => old.deps[n] !== x)) queue.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    };
    react.useLayoutEffect = react.useEffect;
    const bar = { style: { width: '0px', transform: 'none' }, offsetWidth: 0, animate(frames, options) {
        const result = { currentTime: 0, finished: new Promise(() => {}), cancel() { this.cancelled = true; } };
        animations.push({ frames, options, result }); return result;
    } };
    const ancestor = { offsetLeft: 91, offsetParent: null };
    const track = { offsetLeft: 17, offsetParent: ancestor, offsetWidth: 320, contains: node => [a, b].includes(node),
        getBoundingClientRect() { throw Error('布局测量不得混入窗口缩放'); },
        querySelector: selector => ['[data-unified-tab-indicator]', '.ant-tabs-ink-bar'].includes(selector) ? bar : active === 'a' ? a : b,
        querySelectorAll: () => [a, b] };
    const a = { offsetLeft: 16, offsetWidth: 28, offsetParent: track };
    const b = { offsetLeft: 140, offsetWidth: 56, offsetParent: track };
    const host = { querySelector: () => track };
    const root = { current: native ? { nativeElement: host } : track };
    class Observer {
        constructor(fn) { this.fn = fn; this.connected = true; observers.push(this); }
        observe() {} disconnect() { this.connected = false; }
    }
    class Mutations {
        constructor(fn) { this.fn = fn; this.connected = true; mutations.push(this); }
        observe(_node, options) { this.options = options; } disconnect() { this.connected = false; }
    }
    const events = { addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
    const dependencies = { react, '../产品/胶囊滑动动效': { createCapsuleSlideMotion(port) {
        factories++;
        return { moveTo(frame, immediate) { movements.push({ frame, immediate }); if (immediate) port.move(frame); else port.play([port.read(), frame], 180); },
            stop() { stops++; }, finish() { if (movements.length) port.move(movements.at(-1).frame); } };
    } } };
    const exports = load('扩展功能/主题/统一页签横条.ts', dependencies, {
        ResizeObserver: Observer, MutationObserver: Mutations, window: events, document: { ...events, visibilityState: 'visible' },
        getComputedStyle: node => node.style, DOMMatrixReadOnly: class { constructor(transform) { this.m41 = Number(transform?.match(/translateX\(([-.\d]+)px\)/)?.[1] || 0); this.a = 1; } },
    });
    return { ...exports, track, a, b, bar, movements, observers, mutations, animations, listeners, factories: () => factories, stops: () => stops,
        render(key, reduced = false, enabled = true) { cursor = 0; active = key; exports.useUnifiedTabIndicator(root, key, { native, reduced, enabled }); queue.splice(0).forEach(fn => fn()); },
        unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    };
}
test('布局坐标不依赖窗口缩放或按压矩形，嵌套offset保持相对位置', () => {
    const f = fixture();
    assert.deepEqual(f.tabIndicatorFrame(f.track, f.b), { x: 140, width: 56 });
    const nested = { offsetLeft: 11, offsetParent: f.track }, child = { offsetLeft: 9, offsetWidth: 42, offsetParent: nested };
    f.track.contains = () => true;
    assert.deepEqual(f.tabIndicatorFrame(f.track, child), { x: 20, width: 42 });
    f.track.offsetWidth = 0; assert.equal(f.tabIndicatorFrame(f.track, child), null);
});
test('原生与自定义横条复用同一弹簧，首次就位，切换播放原生transform，尺寸变化和减少动态效果不补间', () => {
    for (const native of [false, true]) {
        const f = fixture(native);
        f.render('a'); assert.equal(f.movements[0].immediate, true);
        assert.equal(f.bar.style.width, '28px'); assert.equal(f.bar.style.transform, 'translateX(16px)');
        f.render('b'); assert.equal(f.movements.at(-1).immediate, false); assert.equal(f.animations.length, 1);
        assert.match(f.animations[0].frames.at(-1).transform, /translateX\(140px\).*scaleX\(1\)/);
        assert.equal(f.animations[0].options.easing, 'linear');
        const count = f.movements.length;
        f.observers.at(-1).fn(); f.mutations.at(-1).fn(); assert.equal(f.movements.length, count, '观察器首回调不打断正在播放的弹簧');
        f.b.offsetWidth = 64; f.observers.at(-1).fn(); assert.equal(f.movements.at(-1).immediate, true);
        f.render('a', true); assert.equal(f.movements.at(-1).immediate, true);
        assert.equal(f.factories(), 1); assert.ok(!f.mutations.at(-1).options.attributeFilter.includes('style'), '播放器样式写入不能触发观察反馈循环');
        f.render('b', false, false); assert.ok(f.stops() > 0);
        f.unmount(); assert.equal(f.listeners.size, 0); assert.ok(f.observers.every(observer => !observer.connected)); assert.ok(f.mutations.every(observer => !observer.connected));
    }
});
test('Excel残留手绘开关改用同一原生Switch，布尔状态和既有持久键保持', () => {
    const values = [], writes = []; let cursor = 0;
    const react = { useState(initial) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; }, useMemo: fn => fn() };
    const item = { id: 'p', title: '提示词', prompt: '内容', tags: [], excelPrompt: { key: 'p', templateId: 't' } };
    const module = load('扩展功能/Excel画布/Excel提示词列表.tsx', {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Switch: 'Switch' }, 'lucide-react': { BookOpen: 'BookOpen', ChevronRight: 'ChevronRight' },
        '@/stores/use-theme-store': { useThemeStore: selector => selector({ theme: 'light' }) },
        '../本机存储/上游浏览器存储桥': { sqlitePreferences: { getItem: () => 'false', setItem: (...args) => writes.push(args) } },
        './Excel画布上下文': { useExcelProductId: () => 'product', useExcelPromptContext: () => ({ activeProductName: '产品' }), useExcelPromptSource: () => ({ source: { enabled: true, name: '来源' }, items: [item] }) },
        './Excel拖入校验': { EXCEL_PROMPT_DRAG_TYPE: 'excel' }, './Excel提示词列表.css': {},
        '../产品配置/功能开关': { productFeatures: { excel: true } },
    });
    const render = () => { cursor = 0; return module.ExcelPromptGroup({ keyword: '', theme: { node: { text: '#111' } }, renderRow: () => null }); };
    let control = all(render()).find(node => node.type === 'Switch');
    assert.equal(control.props.size, 'small'); assert.equal(control.props.checked, false);
    control.props.onChange(true); control = all(render()).find(node => node.type === 'Switch'); assert.equal(control.props.checked, true);
    assert.deepEqual(writes, [['guan-excel-import-video-prompts-v2', 'true']]);
    assert.doesNotMatch(read('扩展功能/Excel画布/Excel提示词列表.css'), /guan-excel-video-track/);
});
test('底层规则登记所有统一类别，新设计链接公共实现，窗口没有专用淡变特例', () => {
    const spec = read('开发文档/基础交互动效规范.md');
    for (const name of ['面板展开与关闭', '下拉菜单', '页签内容', '页签横条', '按钮开关', '按钮按压', '悬浮说明', '主题切换', '加载、进度']) assert.ok(spec.includes(name), name);
    assert.match(read('AGENTS.md'), /基础交互动效规范\.md/);
    assert.match(read('扩展功能/主题/统一页签横条.ts'), /createCapsuleSlideMotion/);
    const modal = read('.运行/3100源/画布副本/web/src/components/layout/app-config-modal.tsx');
    assert.doesNotMatch(modal, /transitionName=|maskTransitionName=|renderTabBar/);
    assert.match(read('扩展功能/主题/界面动态偏好.tsx'), /Tabs: \{ motionDurationSlow: "0\.18s"/);
});
