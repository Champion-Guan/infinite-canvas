import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { variantModules } from './产品变体生成夹具.mjs';

const rules = variantModules().load('画布交互/浮层可见区域.ts');
const view = { left: 0, top: 0, right: 1440, bottom: 900 };
const canvas = { left: 300, top: 100, right: 1440, bottom: 900 };
const dock = { left: 400, top: 820, right: 1400, bottom: 880 };
const bounds = rules.floatingBounds(view, canvas, dock);
const inside = r => {
    assert.ok(r.left >= bounds.left); assert.ok(r.top >= bounds.top);
    assert.ok(r.left + r.width <= bounds.right); assert.ok(r.top + r.height <= bounds.bottom);
};

test('真实画布边界扣除侧栏、标题区、底部工具栏和12px安全距离', () => {
    assert.deepEqual(bounds, { left: 312, top: 176, right: 1428, bottom: 808 });
    assert.deepEqual(rules.floatingBounds(view), { left: 12, top: 12, right: 1428, bottom: 888 });
});

test('四边四角及大于可用区域的窗口均完整限制在同一边界', () => {
    for (const width of [128, 356, 600, 2000]) for (const height of [40, 300, 1200])
        for (const left of [-100, 310, 1400]) for (const top of [-100, 400, 870])
            inside(rules.fitFloatingRect({ left, top, right: left + width, bottom: top + height }, bounds));
});

test('长面板依次选择下、上、两侧或停靠，不改动源卡片位置', () => {
    for (const anchor of [
        { left: 500, top: 200, right: 600, bottom: 280 },
        { left: 500, top: 700, right: 600, bottom: 780 },
        { left: 320, top: 400, right: 420, bottom: 600 },
        { left: 1100, top: 400, right: 1200, bottom: 600 },
        { left: 700, top: 400, right: 950, bottom: 600 },
    ]) {
        const before = structuredClone(anchor);
        const result = rules.placeCanvasPanel(anchor, { width: 600, height: 500 }, bounds);
        inside(result);
        assert.ok(result.left + result.width <= anchor.left || result.left >= anchor.right
            || result.top + result.height <= anchor.top || result.top >= anchor.bottom, '面板不能覆盖卡片及功能栏');
        assert.deepEqual(anchor, before);
    }
    assert.equal(rules.placeCanvasPanel({ left: 500, top: 200, right: 600, bottom: 250 }, { width: 400, height: 200 }, bounds).side, 'bottom');
    assert.equal(rules.placeCanvasPanel({ left: 500, top: 700, right: 600, bottom: 750 }, { width: 400, height: 200 }, bounds).side, 'top');
    assert.notEqual(rules.placeCanvasPanel({ left: 750, top: 400, right: 950, bottom: 600 }, { width: 600, height: 1200 }, bounds).side, 'unavailable');
});

test('同一屏幕锚点在不同画布缩放下保持600px阅读尺寸，小视区自动收窄', () => {
    for (const scale of [.1, .5, 1, 2, 4]) {
        const worldWidth = 300 / scale, worldHeight = 200 / scale;
        const anchor = { left: 600, top: 300, right: 600 + worldWidth * scale, bottom: 300 + worldHeight * scale };
        assert.equal(rules.placeCanvasPanel(anchor, { width: 600, height: 300 }, bounds).width, 600);
    }
    const small = rules.floatingBounds({ left: 0, top: 0, right: 640, bottom: 480 }, { left: 240, top: 80, right: 640, bottom: 480 }, { left: 250, top: 400, right: 630, bottom: 460 });
    const result = rules.placeCanvasPanel({ left: 600, top: 430, right: 700, bottom: 500 }, { width: 600, height: 500 }, small);
    assert.ok(result.left >= small.left && result.top >= small.top);
    assert.ok(result.width <= small.right - small.left);
    assert.ok(result.height <= small.bottom - small.top);
});

test('客户截图的侧边停靠不覆盖宽于卡片的功能栏，满视区只在明确打开时留出空间', () => {
    const obstacle = { left: 584, right: 878, top: 192, bottom: 458 };
    const safe = { left: 260, top: 160, right: 1428, bottom: 690 };
    const panel = rules.placeCanvasPanel(obstacle, { width: 600, height: 253 }, safe);
    assert.ok(panel.left >= obstacle.right + 12 || panel.left + panel.width <= obstacle.left - 12
        || panel.top + panel.height <= obstacle.top - 12 || panel.top >= obstacle.bottom + 12);
    const huge = { position: { x: 100, y: 300 }, width: 1000, height: 800 };
    const next = rules.revealCanvasPanel({ x: 0, y: 0, k: 4 }, huge, safe, { left: 248, top: 84, right: 1440, bottom: 722 });
    const rect = { left: 248 + next.x + huge.position.x * next.k, right: 248 + next.x + (huge.position.x + huge.width) * next.k,
        top: 84 + next.y + huge.position.y * next.k - 60, bottom: 84 + next.y + (huge.position.y + huge.height) * next.k };
    const fit = rules.placeCanvasPanel(rect, { width: 600, height: 313 }, safe);
    assert.ok(fit.width >= 240 && fit.height >= 140);
    assert.ok(fit.top >= rect.bottom + 12 || fit.left + fit.width <= rect.left - 12 || fit.left >= rect.right + 12 || fit.top + fit.height <= rect.top - 12);
});

test('左右面板紧邻卡片且顶边对齐，不被顶部宽功能栏推远', () => {
    const safe = { left: 260, top: 160, right: 1428, bottom: 700 };
    const card = { left: 532, top: 300, right: 777, bottom: 472 };
    const toolbar = { left: 295, top: 238, right: 1012, bottom: 286 };
    const right = rules.placeCanvasPanel(card, { width: 600, height: 313 }, safe, toolbar);
    assert.equal(right.side, 'right');
    assert.equal(right.left, card.right + 12);
    assert.equal(right.top, card.top);
    const mirrorCard = { left: 1020, right: 1265, top: 300, bottom: 472 };
    const mirrorBar = { left: 780, right: 1428, top: 238, bottom: 286 };
    const left = rules.placeCanvasPanel(mirrorCard, { width: 600, height: 313 }, safe, mirrorBar);
    assert.equal(left.side, 'left');
    assert.equal(left.left + left.width, mirrorCard.left - 12);
    assert.equal(left.top, mirrorCard.top);
    for (const result of [right, left]) for (const obstacle of result === right ? [card, toolbar] : [mirrorCard, mirrorBar])
        assert.ok(result.left >= obstacle.right || result.left + result.width <= obstacle.left || result.top >= obstacle.bottom || result.top + result.height <= obstacle.top);
});

test('原长设置面板只改变出现位置，优先卡片两侧且避开卡片和顶部功能栏', () => {
    const safe = { left: 260, top: 160, right: 1428, bottom: 700 };
    const card = { left: 640, top: 300, right: 880, bottom: 470 };
    const bar = { left: 560, top: 238, right: 960, bottom: 286 };
    const result = rules.placeCanvasSettings(card, { width: 356, height: 920 }, safe, bar);
    assert.equal(result.side, 'right');
    assert.equal(result.left, card.right + 12);
    assert.equal(result.width, 356);
    assert.equal(result.top, card.top);
    assert.equal(result.height, safe.bottom - card.top);
    const rightCard = { left: 1100, top: 500, right: 1380, bottom: 660 };
    const mirrored = rules.placeCanvasSettings(rightCard, { width: 356, height: 920 }, safe);
    assert.equal(mirrored.side, 'left');
    assert.equal(mirrored.left + mirrored.width, rightCard.left - 12);
    assert.ok(mirrored.top >= safe.top && mirrored.top + mirrored.height <= safe.bottom);
    assert.ok(result.left >= bar.right || result.top >= bar.bottom || result.top + result.height <= bar.top);
});

test('实际公共入口覆盖原生设置、菜单、选择器、工具提示及自定义菜单，不只覆盖截图', () => {
    const source = path => readFileSync('.运行/3100源/画布副本/web/src/' + path, 'utf8');
    const shared = readFileSync('扩展功能/主题/原生可关闭浮层.tsx', 'utf8');
    assert.equal((shared.match(/useNativePopupBoundary\(/g) || []).length, 4);
    assert.doesNotMatch(shared, /useFloatingBoundary\(/);
    assert.match(shared, /getPopupContainer: popupContainer/);
    for (const file of ['canvas-context-menu','canvas-create-menus','canvas-node-hover-toolbar','canvas-prompt-chip-input','canvas-resource-mention-textarea','canvas-config-composer'])
        assert.match(source('components/canvas/' + file + '.tsx'), /CanvasFloatingBoundary/);
    assert.match(source('components/ui/select.tsx'), /CanvasFloatingBoundary/);
    assert.doesNotMatch(source('components/canvas/canvas-node.tsx'), /top-full.*w-\[600px\]/);
    const panel = readFileSync('扩展功能/画布连线/卡片浮层.tsx', 'utf8');
    assert.match(panel, /document.body/); assert.match(panel, /placeCanvasPanel/);
    assert.match(source('components/canvas/infinite-canvas.tsx'), /dispatchEvent\(new Event\(CANVAS_FLOATING_CHANGE\)\)/);
});

test('公共接线按需调度、保留居中变换，尺寸变化重新限制，关闭清理观察与样式', () => {
    let cleanup, queued = 0, callbacks = new Map(), cancelled = [], disconnected = false;
    const listeners = new Map(), observed = new Set();
    const globals = Object.fromEntries(['window','ResizeObserver','MutationObserver','CSS','requestAnimationFrame','cancelAnimationFrame','getComputedStyle'].map(key => [key, globalThis[key]]));
    const bounds = { left: 312, top: 176, right: 1428, bottom: 808 };
    const element = {
        style: {}, dataset: {}, offsetWidth: 600, hasAttribute: () => false,
        getAttribute() { return JSON.stringify(this.style); },
        getBoundingClientRect() {
            const width = Math.min(600, parseFloat(this.style.maxWidth) || 600), height = Math.min(700, parseFloat(this.style.maxHeight) || 700);
            const parts = this.style.translate?.match(/\+ (-?[\d.]+)px/g)?.map(x => parseFloat(x.slice(2))) || [0,0];
            return { left: 1300 + parts[0], top: 760 + parts[1], right: 1300 + parts[0] + width, bottom: 760 + parts[1] + height, width, height };
        },
    };
    const source = { closest: () => ({ querySelector: () => null }) };
    try {
        globalThis.window = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
        globalThis.ResizeObserver = class { constructor(fn) { this.callback = fn; } observe(e) { observed.add(e); } disconnect() { disconnected = true; } };
        globalThis.MutationObserver = class { observe() {} disconnect() {} };
        globalThis.requestAnimationFrame = fn => { callbacks.set(++queued, fn); return queued; };
        globalThis.cancelAnimationFrame = id => { cancelled.push(id); callbacks.delete(id); };
        globalThis.getComputedStyle = () => ({ translate: '-50% 0px' });
        globalThis.CSS = { escape: value => value };
        const loader = variantModules({
            react: { useRef: current => ({ current }), useLayoutEffect: fn => { cleanup = fn(); } },
            './浮层可见区域': { ...rules, readCanvasFloatingBounds: () => bounds },
        });
        loader.load('画布交互/浮层边界接线.ts').useFloatingBoundary(true, () => source, () => element);
        inside({ ...element.getBoundingClientRect(), width: 600, height: 632 });
        assert.match(element.style.translate, /calc\(-50% \+/);
        assert.equal(element.style.overflowY, 'auto');
        assert.ok(observed.has(element));
        const once = queued;
        listeners.get(rules.CANVAS_FLOATING_CHANGE)(); listeners.get(rules.CANVAS_FLOATING_CHANGE)();
        assert.equal(queued, once, '已有待调度帧时不重复注册');
        const next = [...callbacks.values()][0]; callbacks.clear(); next();
        bounds.bottom = 600;
        listeners.get('resize')(); const resize = [...callbacks.values()][0]; callbacks.clear(); resize();
        assert.equal(element.style.maxHeight, '424px');
        cleanup();
        assert.equal(listeners.size, 0); assert.equal(disconnected, true);
        assert.equal(element.style.translate, '');
        assert.equal(element.dataset.canvasFloatingBounded, undefined);
        assert.ok(cancelled.length);
    } finally {
        for (const [key, value] of Object.entries(globals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
});

test('设置定位不读取动画矩形，反复尺寸通知不跳动，内部滚动不重定位，关闭取消所有调度', () => {
    const keys = ['window','ResizeObserver','CSS','Node','requestAnimationFrame','cancelAnimationFrame'];
    const original = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
    try {
        const listeners = new Map(), frames = new Map(); let id = 0, observer, disconnected = 0;
        globalThis.window = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
        globalThis.ResizeObserver = class { constructor(fn) { observer = fn; } observe() {} disconnect() { disconnected++; } };
        globalThis.CSS = { escape: x => x }; globalThis.Node = class {};
        globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
        globalThis.cancelAnimationFrame = id => frames.delete(id);
        const safe = { left: 312, top: 176, right: 1428, bottom: 808 };
        const loader = variantModules({ './浮层可见区域': { ...rules, readCanvasFloatingBounds: () => safe } });
        const place = loader.load('画布交互/设置浮层稳定定位.ts').positionSettingsPanel;
        const card = { dataset: { nodeId: 'source' }, closest: () => ({ querySelector: () => null }),
            getBoundingClientRect: () => ({ left: 500, right: 600, top: 300, bottom: 450 }) };
        const source = { closest: s => s === '[data-node-id]' ? card : null,
            getBoundingClientRect: () => ({ left: 500, right: 600, top: 300, bottom: 340, width: 100 }) };
        const content = { offsetHeight: 920 };
        const panel = { style: {}, offsetWidth: 356, contains: () => true,
            getBoundingClientRect() { throw Error('不能使用动画中的视觉尺寸'); } };
        const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
        for (let opening = 0; opening < 3; opening++) {
            panel.style = {};
            const close = place(panel, content, source, 'topLeft');
            assert.deepEqual(panel.style, { width: '356px', left: '500px', top: '348px', maxHeight: '448px', visibility: 'visible' });
            for (let n = 0; n < 10; n++) { observer(); observer(); assert.equal(frames.size, 1); flush(); }
            assert.equal(panel.style.left, '500px'); assert.equal(panel.style.top, '348px');
            listeners.get('scroll')({ target: new Node() }); assert.equal(frames.size, 0);
            safe.bottom = 600; listeners.get('resize')(); flush();
            assert.equal(panel.style.maxHeight, '240px');
            observer(); close(); assert.equal(frames.size, 0); assert.equal(listeners.size, 0);
            safe.bottom = 808;
        }
        assert.equal(disconnected, 3);
    } finally { for (const [key,value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});
