import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function load(file, dependencies = {}, globals = {}) {
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
        name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
        module, module.exports, ...Object.values(globals));
    return module.exports;
}
function hooks() {
    const cells = [];
    let cursor = 0, effects = [];
    const effect = (callback, deps) => {
        const index = cursor++, old = cells[index];
        if (!old || deps.some((value, i) => value !== old.deps[i])) {
            effects.push(() => { old?.cleanup?.(); cells[index] = { deps, cleanup: callback() }; });
        }
    };
    return {
        react: {
            useRef(value) { const index = cursor++; return cells[index] ||= { current: value }; },
            useState(value) { const index = cursor++; cells[index] ||= { value }; return [cells[index].value, next => { cells[index].value = next; }]; },
            useEffect: effect, useLayoutEffect: effect,
            useCallback: fn => fn, useMemo: fn => fn(),
        },
        render(fn) { cursor = 0; effects = []; const result = fn(); effects.forEach(run => run()); return result; },
        close() { cells.forEach(cell => cell.cleanup?.()); },
    };
}
const { createCanvasPanScheduler } = load('扩展功能/画布布局/画布平移调度.ts');
function fixture(t) {
    const canvasHooks = hooks(), mapHooks = hooks(), frames = new Map(), paints = [], commits = [];
    let frameId = 0;
    const viewportRef = { current: { x: 20, y: 40, k: .05 } }, controllerRef = { current: null };
    const size = { width: 1200, height: 800 };
    const jsx = (type, props) => ({ type, props });
    const shared = {
        'react/jsx-runtime': { jsx, jsxs: jsx },
        '@/lib/canvas-theme': { canvasThemes: { light: { canvas: {}, toolbar: {}, node: {} } } },
        '@/stores/use-theme-store': { useThemeStore: select => select({ theme: 'light' }) },
    };
    const { InfiniteCanvas } = load('.运行/3100源/画布副本/web/src/components/canvas/infinite-canvas.tsx', {
        ...shared, react: canvasHooks.react,
        '@/扩展功能/画布交互/快捷键边界': {},
        '@/扩展功能/产品/产品界面边界': { useProductActive: () => true },
        '@/扩展功能/画布布局/画布平移调度': { createCanvasPanScheduler },
    }, {
        window: { addEventListener() {}, removeEventListener() {} }, document: { body: { style: {} } },
        requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame: id => frames.delete(id),
    });
    const { Minimap } = load('.运行/3100源/画布副本/web/src/components/canvas/canvas-mini-map.tsx', {
        ...shared, react: mapHooks.react, '@/lib/canvas/node-registry': { getNodeDefinition: () => null },
    });
    const containerRef = { current: { clientWidth: size.width, clientHeight: size.height,
        addEventListener() {}, removeEventListener() {} } };
    const renderCanvas = () => canvasHooks.render(() => InfiniteCanvas({
        containerRef, viewportControllerRef: controllerRef, viewport: viewportRef.current, tool: 'pan',
        onViewportPreview: next => { viewportRef.current = next; paints.push(next); },
        onViewportChange: next => { viewportRef.current = next; commits.push(next); },
    }));
    let mapTree;
    const renderMap = () => {
        mapTree = mapHooks.render(() => Minimap({
            nodes: [], viewport: viewportRef.current, viewportSize: size,
            onViewportStart() {
                controllerRef.current.finish();
                controllerRef.current.begin(viewportRef.current);
                return viewportRef.current;
            },
            onViewportChange: next => controllerRef.current.move(next),
            onViewportEnd: () => controllerRef.current.finish(),
        }));
        mapTree.props.children.props.ref.current = {
            getBoundingClientRect: () => ({ left: 0, top: 0 }), closest: () => null,
        };
        return mapTree.props.children.props;
    };
    renderCanvas();
    t.after(() => { mapHooks.close(); canvasHooks.close(); });
    const event = (x, y) => ({ clientX: x, clientY: y, pointerId: 1,
        currentTarget: { setPointerCapture() {} }, preventDefault() {}, stopPropagation() {} });
    return {
        viewportRef, paints, commits,
        zoom(k) { viewportRef.current = { x: 100, y: 200, k }; renderCanvas(); },
        click(x = 100, y = 60) {
            const props = renderMap(); props.onPointerDown(event(x, y)); props.onPointerUp(); renderCanvas();
        },
        drag() {
            renderMap().onPointerDown(event(100, 60));
            const props = renderMap(); props.onPointerMove(event(160, 120));
            props.onPointerUp(); renderCanvas();
        },
    };
}

test('5%小地图定位后放大到100%，再次点击只平移，不回放旧缩放', t => {
    const f = fixture(t);
    f.click();
    f.zoom(1);
    f.paints.length = 0;
    f.click(160, 120);
    assert.equal(f.viewportRef.current.k, 1);
    assert.ok(f.paints.every(view => view.k === 1), '交接期间也不能闪回5%');
    assert.notDeepEqual(f.viewportRef.current, { x: 100, y: 200, k: 1 });
});

test('连续改变缩放后小地图点击和拖动均保留最新比例，最终视区完成提交', t => {
    const f = fixture(t);
    f.click();
    for (const k of [1, 2, .25, .05, 5, 1]) {
        f.zoom(k);
        f.drag();
        assert.equal(f.viewportRef.current.k, k);
        assert.deepEqual(f.commits.at(-1), f.viewportRef.current);
    }
});
