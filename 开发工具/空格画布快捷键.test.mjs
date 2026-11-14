import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function load(file, dependencies, globals) {
    dependencies = { '@/扩展功能/画布交互/浮层可见区域': variantModules().load('画布交互/浮层可见区域.ts'), ...dependencies };
    const code = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
        name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
        module, module.exports, ...Object.values(globals));
    return module.exports;
}
class Element {
    constructor(selectors = [], parent = null) { this.selectors = new Set(selectors); this.parent = parent; }
    matches(selector) { return selector.split(',').some(item => this.selectors.has(item.trim())); }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
}
function fixture() {
    const cells = [], listeners = new Map(), moves = [], selections = [];
    let cursor = 0, active = true, dialogs = [];
    const document = { body: { style: {} }, querySelectorAll: () => dialogs };
    const window = {
        addEventListener(name, callback, capture = false) { listeners.set(`${name}:${capture}`, callback); },
        removeEventListener(name, callback, capture = false) {
            if (listeners.get(`${name}:${capture}`) === callback) listeners.delete(`${name}:${capture}`);
        },
    };
    const globals = { Element, document, window, getComputedStyle: () => ({ visibility: 'visible' }) };
    const boundary = load('扩展功能/画布交互/快捷键边界.ts', {}, globals);
    const react = {
        useRef(value) { const index = cursor++; return cells[index] ||= { current: value }; },
        useState(value) { const index = cursor++; cells[index] ||= { value }; return [cells[index].value, next => { cells[index].value = next; }]; },
        useLayoutEffect() {},
        useEffect(callback, deps) {
            const index = cursor++, old = cells[index];
            if (!old || deps.some((value, i) => value !== old.deps[i])) {
                old?.cleanup?.(); cells[index] = { deps, cleanup: callback() };
            }
        },
    };
    const scheduler = { latest: null, begin(viewport) { this.latest = viewport; }, move(viewport) { this.latest = viewport; moves.push(viewport); },
        flush() { return this.latest; }, dispose() {} };
    const jsx = (type, props) => ({ type, props });
    const { InfiniteCanvas } = load('.运行/3100源/画布副本/web/src/components/canvas/infinite-canvas.tsx', {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx },
        '@/扩展功能/画布交互/快捷键边界': boundary,
        '@/扩展功能/产品/产品界面边界': { useProductActive: () => active },
        '@/扩展功能/画布布局/画布平移调度': { createCanvasPanScheduler: () => scheduler },
        '@/lib/canvas-theme': { canvasThemes: { light: { canvas: {} } } },
        '@/stores/use-theme-store': { useThemeStore: select => select({ theme: 'light' }) },
    }, globals);
    const containerRef = { current: { addEventListener() {}, removeEventListener() {}, setPointerCapture() {},
        focus(options) { assert.deepEqual(options, { preventScroll: true }); document.activeElement = this; } } };
    const render = () => {
        cursor = 0;
        return InfiniteCanvas({ containerRef, viewport: { x: 0, y: 0, k: 1 }, tool: 'select',
            onViewportChange() {}, onCanvasMouseDown: () => selections.push('select'), children: null });
    };
    let tree = render();
    const pointerAction = target => tree.props.onPointerDownCapture({ target, button: 0, currentTarget: containerRef.current });
    const key = (name, target, options = {}, up = false) => {
        const event = { key: name, code: name === ' ' ? 'Space' : name, target, defaultPrevented: false, ...options,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
        listeners.get(`${up ? 'keyup' : 'keydown'}:true`)?.(event);
        return event;
    };
    const down = () => tree.props.onPointerDown({ target: new Element(), button: 0, clientX: 100, clientY: 100,
        pointerId: 1, currentTarget: containerRef.current, preventDefault() {} });
    const drag = () => { down(); listeners.get('pointermove:false')?.({ clientX: 160, clientY: 140 }); listeners.get('pointerup:false')?.(); };
    return { key, pointerAction, drag, moves, selections, listeners, document, surface: containerRef.current,
        rerender() { tree = render(); return tree; },
        hide() { active = false; tree = render(); },
        modal() { dialogs = [{ closest: () => null, getClientRects: () => [{}] }]; },
        blur() { listeners.get('blur:false')(); },
        unmount() { cells.forEach(cell => cell.cleanup?.()); },
    };
}

test('鼠标操作AI按钮后按空格，按下和松开均阻止原生激活，直接拖动立即平移且不等React重渲染', () => {
    const f = fixture(), node = new Element(['[data-node-id]']), content = new Element(['[data-canvas-no-zoom]'], node),
        button = new Element(['button'], content), icon = new Element([], button);
    f.pointerAction(icon);
    const down = f.key(' ', button), repeat = f.key(' ', button, { repeat: true });
    assert.equal(down.defaultPrevented, true); assert.equal(down.stopped, true);
    assert.equal(repeat.defaultPrevented, true);
    f.drag();
    assert.deepEqual(f.moves, [{ x: 60, y: 40, k: 1 }]);
    assert.deepEqual(f.selections, []);
    const up = f.key(' ', button, {}, true);
    assert.equal(up.defaultPrevented, true); assert.equal(up.stopped, true);
    f.drag();
    assert.deepEqual(f.selections, ['select'], '松开空格后立即恢复选择工具');
    f.unmount(); assert.equal(f.listeners.size, 0);
});

test('关闭面板归还按钮焦点后，点击空白画布接回键盘焦点，空格不会再次打开面板', () => {
    const f = fixture(), trigger = new Element(['button']);
    f.document.activeElement = trigger;
    f.pointerAction(new Element());
    assert.equal(f.document.activeElement, f.surface);
    const down = f.key(' ', f.document.activeElement);
    assert.equal(down.defaultPrevented, true);
    f.drag(); assert.equal(f.moves.length, 1);
    assert.equal(f.key(' ', f.document.activeElement, {}, true).defaultPrevented, true);
    f.unmount();
});

test('鼠标点击输入框、面板或键盘控件不强行聚焦画布，点击普通卡片可接回焦点', () => {
    const f = fixture(), previous = new Element(['button']);
    for (const selector of ['input', 'textarea', 'button', '[role="dialog"]', '[role="menu"]', '[role="switch"]']) {
        f.document.activeElement = previous;
        f.pointerAction(new Element([selector]));
        assert.equal(f.document.activeElement, previous, selector);
    }
    f.pointerAction(new Element(['[data-node-id]']));
    assert.equal(f.document.activeElement, f.surface);
    f.unmount();
});

test('Tab或Enter开始键盘操作后，按钮空格仍交给原生键盘激活', () => {
    for (const first of ['Tab', 'Enter']) {
        const f = fixture(), button = new Element(['button']);
        f.pointerAction(button);
        assert.equal(f.key(first, button).defaultPrevented, false);
        assert.equal(f.key(' ', button).defaultPrevented, false);
        assert.equal(f.key(' ', button, {}, true).defaultPrevented, false);
        f.drag(); assert.equal(f.moves.length, 0); f.unmount();
    }
});

test('输入框、输入法、开关、页签、菜单和可见模态窗口不会被画布抢走空格', () => {
    for (const selectors of [['input'], ['textarea'], ['[contenteditable]:not([contenteditable="false"])'],
        ['button', '[role="switch"]'], ['button', '[role="checkbox"]'], ['button', '[role="tab"]'], ['[role="menu"]'],
        ['button', '[data-canvas-no-zoom]']]) {
        const f = fixture(), target = new Element(selectors);
        f.pointerAction(target);
        assert.equal(f.key(' ', target).defaultPrevented, false, selectors.join(','));
        assert.equal(f.key(' ', target, {}, true).defaultPrevented, false);
        f.drag(); assert.equal(f.moves.length, 0); f.unmount();
    }
    const f = fixture(), button = new Element(['button']);
    f.pointerAction(button);
    assert.equal(f.key(' ', button, { isComposing: true }).defaultPrevented, false);
    f.modal(); assert.equal(f.key(' ', button).defaultPrevented, false); f.unmount();
});

test('只接管刚被鼠标操作的同一个按钮，失焦或隐藏产品后不保留空格及按钮意图', () => {
    const f = fixture(), button = new Element(['button']), other = new Element(['button']);
    f.pointerAction(button);
    assert.equal(f.key(' ', other).defaultPrevented, false);
    assert.equal(f.key(' ', button).defaultPrevented, true);
    f.blur(); f.drag(); assert.equal(f.moves.length, 0);
    assert.equal(f.key(' ', button).defaultPrevented, false);
    f.pointerAction(button); f.key(' ', button); f.hide();
    assert.equal(f.listeners.size, 0); assert.equal(f.document.body.style.cursor, '');
    f.unmount();
});
