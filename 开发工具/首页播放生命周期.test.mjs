import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const jsx = (type, props) => ({ type, props: props || {} });
const elements = value => Array.isArray(value) ? value.flatMap(elements) : value && typeof value === 'object' ? [value, ...elements(value.props?.children)] : [];

function fixture() {
    const cells = [], listeners = new Set(), events = new Map(), actions = [];
    let cursor = 0;
    const same = (one, two) => one?.length === two.length && two.every((value, i) => value === one[i]);
    const hooks = {
        useState(initial) { const i = cursor++; cells[i] ||= { value: typeof initial === 'function' ? initial() : initial }; return [cells[i].value, value => { cells[i].value = typeof value === 'function' ? value(cells[i].value) : value; }]; },
        useRef(initial) { return hooks.useState(() => ({ current: initial }))[0]; },
        useMemo(callback, deps) { const i = cursor++; if (!cells[i] || !same(cells[i].deps, deps)) cells[i] = { value: callback(), deps }; return cells[i].value; },
        useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
        useEffect(callback, deps) { const i = cursor++; if (!cells[i] || !same(cells[i].deps, deps)) { cells[i]?.cleanup?.(); cells[i] = { cleanup: callback(), deps }; } },
    };
    const autoplay = { play: () => actions.push('play'), stop: () => actions.push('stop') };
    const api = {
        plugins: () => ({ autoplay }), selectedScrollSnap: () => 0,
        on(name, callback) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); return api; },
        off(name, callback) { events.get(name)?.delete(callback); return api; },
        scrollTo: (index, jump) => actions.push(['scrollTo', index, jump]), scrollPrev: jump => actions.push(['prev', jump]), scrollNext: jump => actions.push(['next', jump]),
    };
    const media = { matches: false, addEventListener: (_event, callback) => listeners.add(callback), removeEventListener: (_event, callback) => listeners.delete(callback) };
    const dependencies = {
        react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, './轮播依赖.js': { Autoplay: () => autoplay, useEmblaCarousel: () => [() => {}, api] },
        './首页.module.css': { __esModule: true, default: {} }, '../产品/产品回收面板': { ProductTrashEntry: 'Trash' },
    };
    const source = readFileSync(new URL('../扩展功能/首页/工作台首页.tsx', import.meta.url), 'utf8');
    const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'window', javascript)(id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, module, module.exports, { matchMedia: () => media });
    return {
        actions,
        render() { cursor = 0; return module.exports.WorkbenchHome({ theme: 'light', onCreate() {}, onImportProduct() {} }); },
        reinit() { for (const callback of events.get('reInit') || []) callback(); },
        reduce(value) { media.matches = value; for (const callback of listeners) callback(); },
        unmount() { for (const cell of cells) cell.cleanup?.(); assert.equal(listeners.size, 0); assert.equal(events.get('reInit').size, 0); },
    };
}

test('轮播重排后恢复播放；用户手动选择后保持暂停，卸载清理监听', () => {
    const f = fixture(); let tree = f.render();
    assert.equal(f.actions.at(-1), 'play');
    f.reinit(); assert.equal(f.actions.filter(action => action === 'play').length, 2);
    elements(tree).find(item => item.props['aria-label'] === '切换到第 2 个轮播模板').props.onClick();
    tree = f.render();
    assert.ok(elements(tree).some(item => item.props['aria-label'] === '播放轮播'));
    f.reinit(); assert.equal(f.actions.at(-1), 'stop');
    assert.equal(f.actions.filter(action => action === 'play').length, 2);
    f.unmount();
});

test('系统减少动态效果即时停止播放并跳切，关闭偏好后恢复；方向键保持手动控制', () => {
    const f = fixture(); f.render();
    f.reduce(true); const tree = f.render();
    assert.deepEqual(f.actions.at(-2), ['scrollTo', 0, true]); assert.equal(f.actions.at(-1), 'stop');
    assert.equal(elements(tree).find(item => item.props['aria-label'] === '播放轮播').props.disabled, true);
    let prevented = false;
    elements(tree).find(item => item.props['aria-roledescription'] === 'carousel').props.onKeyDownCapture({ key: 'ArrowRight', preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.deepEqual(f.actions.at(-1), ['next', true]);
    f.render(); f.reduce(false); f.render();
    assert.equal(f.actions.at(-1), 'stop', '用户已选择手动切换，不因系统偏好改变而自行播放');
    f.unmount();
});
