import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

function fixture(t) {
    const cells = [], effects = [], timers = new Map();
    const oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout;
    let cursor = 0, dirty = false, active = true, sequence = 0, starts = 0, retry = false, busy = false, identity = 'product:parameter:task';
    const react = {
        useRef(current) { return cells[cursor++] ||= { current }; },
        useState(value) { const index = cursor++; if (!(index in cells)) cells[index] = value;
            return [cells[index], next => { cells[index] = typeof next === 'function' ? next(cells[index]) : next; dirty = true; }]; },
        useEffect(fn, deps) {
            const index = cursor++, old = cells[index];
            if (!old || deps.some((value, i) => value !== old.deps[i])) {
                old?.cleanup?.(); cells[index] = { deps }; effects.push(() => { cells[index].cleanup = fn(); });
            }
        },
    };
    globalThis.setTimeout = (fn, delay) => { const id = ++sequence; timers.set(id, { fn, delay }); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
    t.after(() => {
        for (const cell of cells) cell?.cleanup?.();
        globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear;
    });
    const api = variantModules({ react, '../产品/产品界面边界': { useProductActive: () => active } }).load('Excel画布/策划自动保存.ts');
    let operation = async () => { starts++; return retry; };
    const render = () => {
        do {
            cursor = 0; dirty = false; effects.length = 0;
            api.useAutomaticPlanningSave({ identity, busy, start: operation });
            effects.forEach(fn => fn());
        } while (dirty);
    };
    const fire = async () => {
        const [id, timer] = timers.entries().next().value || [];
        assert.ok(timer); timers.delete(id); timer.fn();
        await new Promise(done => setImmediate(done)); render(); return timer.delay;
    };
    return { api, timers, render, fire, get starts() { return starts; },
        retry(value) { retry = value; }, active(value) { active = value; }, busy(value) { busy = value; },
        identity(value) { identity = value; }, operation(fn) { operation = fn; } };
}

test('待保存结果打开自动确认一次，普通重渲染不重复，查询和修正不自动开始', async t => {
    const f = fixture(t);
    f.identity(''); f.render(); assert.equal(f.timers.size, 0);
    f.identity('product:parameter:task'); f.render();
    assert.equal(await f.fire(), 0); assert.equal(f.starts, 1); assert.equal(f.timers.size, 0);
    for (let i = 0; i < 30; i++) f.render();
    assert.equal(f.starts, 1); assert.equal(f.timers.size, 0);
    f.identity('product:parameter:task2'); f.render(); await f.fire();
    assert.equal(f.starts, 2);
});

test('暂时失败最多三次，2秒和6秒退避；失败后保留手动入口，不热循环', async t => {
    const f = fixture(t); f.retry(true); f.render();
    assert.equal(await f.fire(), 0);
    f.identity(''); f.render();
    f.identity('product:parameter:task'); f.render();
    assert.equal(await f.fire(), 2000);
    assert.equal(await f.fire(), 6000);
    assert.equal(f.starts, 3); assert.equal(f.timers.size, 0);
    for (const code of ['generation_canvas_unsaved', 'request_timeout', 'generation_connection_unknown'])
        assert.equal(f.api.retryPlanningSave({ code }), true);
    for (const code of ['generation_not_found', 'generation_scope_mismatch', 'invalid_product_plan_protocol', 'disk_full'])
        assert.equal(f.api.retryPlanningSave({ code }), false);
    assert.equal(f.api.retryPlanningSave(Error('未知失败')), false);
});

test('正在策划及隐藏画布不自动确认，返回后恢复；不并行发起两次', async t => {
    const f = fixture(t); f.busy(true); f.render(); assert.equal(f.timers.size, 0);
    f.busy(false); f.active(false); f.render(); assert.equal(f.timers.size, 0);
    let finish; f.operation(() => new Promise(resolve => { finish = resolve; }));
    f.active(true); f.render(); await f.fire();
    for (let i = 0; i < 20; i++) f.render();
    assert.equal(f.timers.size, 0);
    finish(false); await new Promise(done => setImmediate(done)); f.render();
    assert.equal(f.timers.size, 0);
});

test('结构或权限错误停止自动重试，切换任务不会执行旧计时器', async t => {
    const f = fixture(t); f.render();
    f.identity(''); f.render(); assert.equal(f.timers.size, 0); assert.equal(f.starts, 0);
    f.identity('new'); f.operation(async () => { throw Error('invalid receipt'); }); f.render();
    await f.fire(); assert.equal(f.timers.size, 0);
});
