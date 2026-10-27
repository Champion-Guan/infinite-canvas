import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function load(name, dependencies = {}, globals = {}) {
    const js = ts.transpileModule(readFileSync(new URL('../扩展功能/' + name, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), js)(id => { assert.ok(id in dependencies, id); return dependencies[id]; }, module, module.exports, ...Object.values(globals));
    return module.exports;
}

test('四类设置浮层在窄窗、顶部、底部及屏外锚点都处于可视范围，空间不足翻转并滚动', () => {
    const { settingsPopoverPosition: place } = load('画布交互/设置浮层位置.ts');
    for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 480 }, { width: 200, height: 140 }]) {
        for (const top of [-200, 0, 100, viewport.height - 40, viewport.height + 100]) {
            for (const preferred of ['topLeft', 'top', 'topRight', 'bottomLeft', 'bottom', 'bottomRight']) {
                const p = place({ left: viewport.width - 20, right: viewport.width + 80, width: 100, top, bottom: top + 32 }, preferred, viewport);
                assert.ok(p.left >= 0 && p.left + p.width <= viewport.width);
                assert.ok(p.maxHeight >= 0);
                assert.ok((p.top ?? p.bottom) + p.maxHeight <= viewport.height);
                assert.equal(p.overflowY, 'auto');
            }
        }
    }
    assert.ok('top' in place({ left: 10, right: 40, width: 30, top: 20, bottom: 52 }, 'topLeft', { width: 800, height: 600 }));
    assert.ok('bottom' in place({ left: 10, right: 40, width: 30, top: 550, bottom: 582 }, 'bottomLeft', { width: 800, height: 600 }));
});

test('同媒体100次并发只读一次、生成一个URL；每个调用保持自己的缺失回退，失败后可重新读取', async () => {
    const created = [], revoked = [], { createMediaUrlCache } = load('媒体交付/媒体地址缓存.ts', {}, { URL: { createObjectURL: () => { const url = 'blob:' + created.length; created.push(url); return url; }, revokeObjectURL: value => revoked.push(value) } });
    const cache = createMediaUrlCache(); let reads = 0;
    const result = await Promise.all(Array.from({ length: 100 }, () => cache.resolve('one', async () => { reads++; return new Blob(['image']); }, 'fallback')));
    assert.equal(reads, 1); assert.equal(new Set(result).size, 1); assert.equal(created.length, 1);
    cache.set('one', 'blob:replacement'); assert.deepEqual(revoked, ['blob:0']);
    cache.delete('one'); assert.deepEqual(revoked, ['blob:0', 'blob:replacement']);
    assert.deepEqual(await Promise.all([cache.resolve('missing', async () => null, 'a'), cache.resolve('missing', async () => null, 'b')]), ['a', 'b']);
    await assert.rejects(cache.resolve('bad', async () => { throw Error('read failed'); }, ''));
    assert.equal(await cache.resolve('bad', async () => new Blob(['ok']), ''), 'blob:1');
});

test('删除或替换与在途读取竞态不会复活旧媒体、泄漏URL或覆盖新内容', async () => {
    let finish; const created = [], revoked = [];
    const { createMediaUrlCache } = load('媒体交付/媒体地址缓存.ts', {}, { URL: { createObjectURL: () => { created.push('url'); return 'url'; }, revokeObjectURL: url => revoked.push(url) } });
    const cache = createMediaUrlCache();
    const old = cache.resolve('one', () => new Promise(resolve => { finish = resolve; }), 'missing');
    await Promise.resolve(); cache.delete('one'); finish(new Blob(['old']));
    assert.equal(await old, 'missing'); assert.equal(cache.get('one'), undefined); assert.equal(created.length, 0);
    const replacing = cache.resolve('one', () => new Promise(resolve => { finish = resolve; }), 'missing');
    await Promise.resolve(); cache.set('one', 'new'); finish(new Blob(['old']));
    assert.equal(await replacing, 'new'); assert.equal(created.length, 0); assert.equal(revoked.length, 0);
});

test('画布不截获弹层、输入法、原生按钮的空格；隐藏产品的模态窗口不影响当前画布', () => {
    class Element { constructor(match = '') { this.match = match; } closest(selector) { return selector.includes(this.match) && this.match ? this : null; } }
    let dialogs = [];
    const { ignoreCanvasShortcut: ignore } = load('画布交互/快捷键边界.ts', {}, { Element, document: { querySelectorAll: () => dialogs }, getComputedStyle: () => ({ visibility: 'visible' }) });
    assert.equal(ignore({ target: new Element(), keyCode: 0 }), false);
    for (const match of ['input', 'textarea', '[role="dialog"]', '.ant-select-dropdown']) assert.equal(ignore({ target: new Element(match) }), true);
    assert.equal(ignore({ target: new Element('button') }, true), true);
    assert.equal(ignore({ target: new Element('button') }), false);
    assert.equal(ignore({ isComposing: true }), true); assert.equal(ignore({ defaultPrevented: true }), true);
    dialogs = [{ closest: () => null, getClientRects: () => [{}] }]; assert.equal(ignore({}), true);
    dialogs = [{ closest: () => ({}), getClientRects: () => [{}] }]; assert.equal(ignore({}), false);
});

test('真实浮层Hook：选项Portal不导致父层卸载，Escape先关下拉，隐藏产品和卸载清理监听', () => {
    const cells = [], listeners = new Map(), changes = []; let cursor = 0, active = true, focused = 0;
    const same = (a, b) => a?.length === b.length && b.every((value, index) => a[index] === value);
    const hooks = {
        useState(initial) { const i = cursor++; cells[i] ||= { value: initial }; return [cells[i].value, value => { cells[i].value = value; }]; },
        useRef(initial) { const i = cursor++; return cells[i] ||= { current: initial }; },
        useCallback(callback, deps) { const i = cursor++; if (!cells[i] || !same(cells[i].deps, deps)) cells[i] = { value: callback, deps }; return cells[i].value; },
        useEffect(callback, deps) { const i = cursor++; if (!cells[i] || !same(cells[i].deps, deps)) { cells[i]?.cleanup?.(); cells[i] = { cleanup: callback(), deps }; } },
    };
    class Node {}
    class Element extends Node { constructor(portal = false, select = false) { super(); this.portal = portal; this.select = select; } closest(selector) { return selector.includes('.ant-select-open') ? this.select : selector.includes('.ant-select-dropdown') ? this.portal : null; } }
    const window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } };
    const { useSettingsPopover } = load('画布交互/设置浮层生命周期.ts', { react: hooks, '../产品/产品界面边界': { useProductActive: () => active } }, { window, Node, Element });
    const render = () => { cursor = 0; return useSettingsPopover(value => changes.push(value)); };
    let state = render();
    state.buttonRef.current = { contains: () => false, getBoundingClientRect: () => ({ top: 10 }), querySelector: () => ({ focus() { focused++; } }) };
    state.panelRef.current = { contains: () => false };
    state.updateOpen(true); state = render(); assert.equal(state.open, true); assert.equal(listeners.size, 4);
    listeners.get('pointerdown')({ target: new Element(true) }); state = render(); assert.equal(state.open, true);
    listeners.get('keydown')({ key: 'Escape', target: new Element(false, true) }); state = render(); assert.equal(state.open, true);
    listeners.get('keydown')({ key: 'Escape', target: new Element(), preventDefault() {}, stopPropagation() {} }); state = render();
    assert.equal(state.open, false); assert.equal(listeners.size, 0); assert.equal(focused, 1); assert.deepEqual(changes, [true, false]);
    state.updateOpen(true); state = render(); active = false; render(); assert.equal(listeners.size, 0);
    active = true; render(); assert.equal(listeners.size, 4);
    for (const cell of cells) cell.cleanup?.(); assert.equal(listeners.size, 0);
});
