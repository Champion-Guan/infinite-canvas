import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

test('详情Esc在画布接管前关闭，其他键不关闭，卸载移除监听且不执行恢复操作', t => {
    const before = globalThis.window, handlers = new Map(), effects = [], states = [];
    globalThis.window = {
        addEventListener(name, fn, capture) { handlers.set(name, { fn, capture }); },
        removeEventListener(name, fn, capture) { assert.deepEqual(handlers.get(name), { fn, capture }); handlers.delete(name); },
    };
    t.after(() => { globalThis.window = before; });
    const jsx = (type, props) => ({ type, props });
    const loader = variantModules({
        react: { useState: () => [true, value => states.push(value)], useEffect: fn => effects.push(fn) },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'lucide-react': { CircleAlert: 'CircleAlert', Info: 'Info', X: 'X' },
        './原生可关闭浮层': { OutsidePopover: 'Popover' },
        './状态详情.module.css': { default: { error: 'error', message: 'message' } },
    });
    const { StatusDetails } = loader.load('主题/状态详情.tsx');
    let recoveries = 0, stopped = 0;
    StatusDetails({ label: '策划失败', children: { onClick: () => recoveries++ } });
    const cleanups = effects.map(fn => fn());
    assert.equal(handlers.get('keydown').capture, true);
    handlers.get('keydown').fn({ key: 'Enter', stopPropagation() { stopped++; } });
    assert.deepEqual(states, []);
    handlers.get('keydown').fn({ key: 'Escape', stopPropagation() { stopped++; } });
    assert.deepEqual(states, [false]); assert.equal(stopped, 1); assert.equal(recoveries, 0);
    for (const cleanup of cleanups) cleanup?.();
    assert.equal(handlers.size, 0);
});

test('保存错误通知保留原错误，取消订阅后不再回调，只有显式成功收口才清除', () => {
    const { readReportedSaveFailure, reportSaveFailure, subscribeReportedSaveFailure, clearReportedSaveFailure } =
        variantModules().load('存储界面/保存错误通知.ts');
    const seen = [], unsubscribe = subscribeReportedSaveFailure(() => seen.push(readReportedSaveFailure()));
    reportSaveFailure('保存未确认');
    assert.equal(readReportedSaveFailure(), '保存未确认');
    assert.deepEqual(seen, ['保存未确认']);
    unsubscribe();
    reportSaveFailure('仍未确认');
    assert.deepEqual(seen, ['保存未确认']);
    clearReportedSaveFailure();
    assert.equal(readReportedSaveFailure(), '');
});
