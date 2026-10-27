import test from 'node:test';
import assert from 'node:assert/strict';
import { runThemeTransition } from '../扩展功能/主题/主题过渡生命周期.mjs';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture({ reduced = false, supported = true, delayed = false } = {}) {
  const animation = [], styles = new Map(), transitions = []; let applied = 0;
  const root = { dataset: {}, style: { setProperty: (...a) => styles.set(...a), removeProperty: name => styles.delete(name) }, animate: (...a) => animation.push(a) };
  const document = { documentElement: root, ...(supported ? { startViewTransition(update) {
    const ready = deferred(), finished = deferred();
    const transition = { ready: ready.promise, finished: finished.promise, skipTransition() { ready.reject(Error('skipped')); finished.resolve(); } };
    transitions.push({ ready, finished, transition, update }); if (!delayed) update(); return transition;
  } } : {}) };
  return { root, styles, animation, transitions, count: () => applied,
    run: () => runThemeTransition({ document, window: { matchMedia: () => ({ matches: reduced }) }, apply: () => applied++, clipPath: ['circle(0px)', 'circle(999px)'] }) };
}
test('主题以400ms圆形过渡，结束后清理标记与样式', async () => {
  const f = fixture(), result = f.run(); assert.equal(f.count(), 1);
  f.transitions[0].ready.resolve(); assert.equal(await result, true);
  assert.equal(f.animation[0][1].duration, 400); assert.equal(f.animation[0][1].pseudoElement, '::view-transition-new(root)');
  f.transitions[0].finished.resolve(); await Promise.resolve();
  assert.equal(f.root.dataset.magicuiThemeVt, undefined); assert.equal(f.styles.size, 0);
});
test('减少动态效果或不支持过渡时仍切换主题', async () => {
  for (const settings of [{ reduced: true }, { supported: false }]) {
    const f = fixture(settings); assert.equal(await f.run(), false); assert.equal(f.count(), 1); assert.equal(f.animation.length, 0);
  }
});
test('快切取消旧过渡，旧清理不能擦掉新过渡标记', async () => {
  const f = fixture(), first = f.run(), second = f.run();
  await first; assert.equal(f.root.dataset.magicuiThemeVt, 'active');
  f.transitions[1].ready.resolve(); assert.equal(await second, true); assert.equal(f.count(), 2);
  f.transitions[1].finished.resolve(); await Promise.resolve(); assert.equal(f.styles.size, 0);
});
test('被取消过渡的延迟更新不能覆盖最后一次主题选择', async () => {
  const f = fixture({ delayed: true }), first = f.run(), second = f.run();
  await first;
  f.transitions[1].update(); f.transitions[0].update();
  f.transitions[1].ready.resolve(); await second;
  assert.equal(f.count(), 1);
  f.transitions[1].finished.resolve(); await Promise.resolve();
});
test('ready拒绝、finished拒绝和同步失败不丢主题更新或产生未处理拒绝', async () => {
  const f = fixture(), promise = f.run();
  f.transitions[0].ready.reject(Error('duplicate-name')); f.transitions[0].finished.reject(Error('duplicate-name'));
  assert.equal(await promise, false); assert.equal(f.count(), 1); assert.equal(f.styles.size, 0);
  let calls = 0;
  assert.equal(await runThemeTransition({ document: { documentElement: f.root, startViewTransition() { throw Error('unsupported'); } }, window: {}, clipPath: ['a', 'b'], apply: () => calls++ }), false);
  assert.equal(calls, 1);
});
