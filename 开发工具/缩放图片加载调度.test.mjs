import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

test('每一帧缩放单独通知读数，实例隔离，重复和无效数值不通知', () => {
    const { createCanvasScaleFeedback } = variantModules().load('画布交互/视区即时反馈.ts');
    const first = createCanvasScaleFeedback(), second = createCanvasScaleFeedback(.5), values = [];
    const unsubscribe = first.subscribe(() => values.push(first.getSnapshot()));
    for (let index = 1; index <= 20; index++) first.publish(1 + index / 100);
    first.publish(1.2); first.publish(NaN); first.publish(Infinity); first.publish(0);
    assert.equal(values.length, 20); assert.equal(values.at(-1), 1.2);
    assert.equal(second.getSnapshot(), .5);
    unsubscribe(); first.publish(1.3); assert.equal(values.length, 20);
});

test('低倍缩放保留主网格，屏幕步长不小于12px，高倍网格保持原48单位', () => {
    const { canvasGridStep } = variantModules().load('画布交互/网格缩放步长.ts');
    for (const scale of [.05, .06, .1, .24, .25, .5, 1, 5]) {
        const step = canvasGridStep(scale);
        assert.ok(step >= 12);
        assert.equal(Number.isInteger(Math.log2(step / (48 * scale))), true);
        if (scale >= .25) assert.equal(step, 48 * scale);
    }
});


test('连续缩放只逐帧绘制，停止时一次提交；普通平移仍按可见边界提交', () => {
    let now = 0, id = 0;
    const frames = new Map(), paints = [], commits = [];
    const { createCanvasPanScheduler } = variantModules().load('画布布局/画布平移调度.ts');
    const scheduler = createCanvasPanScheduler({
        paint: value => paints.push(value), commit: value => commits.push(value),
        frame: callback => { frames.set(++id, callback); return id; }, cancel: key => frames.delete(key), now: () => now,
        extent: () => ({ width: 1200, height: 800 }),
    });
    const step = () => { now += 16; const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback()); };
    scheduler.begin({ x: 0, y: 0, k: 1 });
    for (let index = 0; index < 50; index++) { scheduler.move({ x: index * 10, y: index * 8, k: 1 - (index + 1) * .018 }); step(); }
    assert.equal(paints.length, 50); assert.equal(commits.length, 0);
    scheduler.flush(); assert.equal(commits.length, 1); assert.deepEqual(commits[0], scheduler.latest);
    scheduler.begin(scheduler.latest);
    scheduler.move({ ...scheduler.latest, x: 2000 }); step();
    assert.equal(commits.length, 2);
});

test('缩略图读取预算最多三个并发，单项失败后仍释放队列继续读取', async () => {
    const { createPreviewReadQueue } = variantModules().load('媒体交付/缩略图读取队列.ts');
    const read = createPreviewReadQueue();
    let active = 0, peak = 0;
    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, index) => read(async () => {
        active++; peak = Math.max(peak, active);
        try {
            await new Promise(resolve => setImmediate(resolve));
            if (index === 7) throw new Error('读取失败');
            return index;
        } finally { active--; }
    })));
    assert.equal(peak, 3); assert.equal(active, 0);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 29);
});

test('5%慢拖只绘制，接近屏幕缓冲边缘或松手时提交', () => {
    const { createCanvasPanScheduler } = variantModules().load('画布布局/画布平移调度.ts');
    let work, now = 0;
    const paints = [], commits = [];
    const scheduler = createCanvasPanScheduler({ paint: view => paints.push(view.x), commit: view => commits.push(view.x),
        frame: callback => { work = callback; return 1; }, cancel: () => { work = undefined; }, now: () => now });
    const move = x => { scheduler.move({ x, y: 0, k: .05 }); now += 300; work(); };
    scheduler.begin({ x: 0, y: 0, k: .05 });
    move(10); move(50); move(99);
    assert.deepEqual(paints, [10, 50, 99]);
    assert.deepEqual(commits, []);
    move(100); move(140);
    assert.deepEqual(commits, [100]);
    scheduler.flush();
    assert.deepEqual(commits, [100, 140]);
});

test('新增可见卡片分帧挂载，手势暂停队列，已加载卡片随画布驻留而不随裁剪卸载', () => {
    const cells = [], frames = new Map();
    let cursor = 0, id = 0, effects = [];
    const react = {
        useState(initial) {
            const index = cursor++;
            cells[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [cells[index].value, next => { cells[index].value = next; }];
        },
        useRef(value) { const index = cursor++; return cells[index] ??= { current: value }; },
        useEffect(callback, deps) {
            const index = cursor++, old = cells[index];
            if (!old || deps.some((value, at) => value !== old.deps[at])) effects.push(() => {
                old?.cleanup?.(); cells[index] = { deps, cleanup: callback() };
            });
        },
    };
    const previousFrame = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
    globalThis.cancelAnimationFrame = key => frames.delete(key);
    try {
        const { useProgressiveCanvasNodes } = variantModules({ react }).load('画布布局/可见卡片渐进挂载.ts');
        const nodes = Array.from({ length: 40 }, (_, index) => ({ id: String(index), type: 'image' }));
        const render = (value, interacting) => {
            cursor = 0; effects = [];
            const result = useProgressiveCanvasNodes(value, interacting);
            effects.forEach(effect => effect()); return result;
        };
        const step = () => { const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback()); };
        assert.equal(render(nodes, false).size, 0);
        step(); assert.equal(render(nodes, false).size, 4);
        render(nodes, true); step(); assert.equal(render(nodes, true).size, 4);
        const replacement = [{ id: 'other', type: 'guan:prompt-variables' }];
        render(replacement, false); step();
        assert.deepEqual([...render(replacement, false)], ['0', '1', '2', '3', 'other']);
        render(nodes.slice(0, 4), false); step();
        assert.deepEqual([...render(nodes.slice(0, 4), false)], ['0', '1', '2', '3', 'other']);
        assert.equal(frames.size, 0);
    } finally {
        globalThis.requestAnimationFrame = previousFrame; globalThis.cancelAnimationFrame = previousCancel;
    }
});
