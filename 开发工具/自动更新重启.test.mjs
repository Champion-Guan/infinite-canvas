import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAutomaticUpdateRestart } from '../扩展功能/软件更新/自动更新重启.mjs';

const url = 'http://127.0.0.1:12345/' + 'a'.repeat(48) + '/';
function fixture({ failSave = false, state = 'awaiting-browser-exit' } = {}) {
  const calls = [], intervals = new Set(), listeners = {}, panels = [];
  class Channel { postMessage() { calls.push('broadcast'); } close() { calls.push('channel-close'); } }
  function element() { return { setAttribute() {}, append() {}, showModal() {}, addEventListener() {}, close() {}, remove() {} }; }
  const view = { BroadcastChannel: Channel, document: { createElement: element, body: { append: value => panels.push(value) } },
    location: { replace: value => calls.push(['navigate', value]) }, setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(fn) { intervals.delete(fn); },
    addEventListener(type, fn) { listeners[type] = fn; } };
  const cleanup = bindAutomaticUpdateRestart({ view, updatePort: { async request(operation) { calls.push(operation); return operation === 'status' ? { install: { state } } : { url }; } },
    flush: async () => { calls.push('flush'); if (failSave) throw Error('未保存'); }, host: { async close() { calls.push('close'); } } });
  return { view, calls, intervals, cleanup, panels };
}
test('确认后排空保存→释放页面→当前标签转进度；不需要浏览器弹窗', async () => {
  const f = fixture();
  try {
    assert.equal(await f.view.__guanAutomaticUpdateRestart(url), true);
    assert.deepEqual(f.calls, ['broadcast', 'status', 'flush', 'close', ['navigate', url]]);
  } finally { f.cleanup(); }
  assert.equal(f.intervals.size, 0);
});
test('保存失败保留页面授权与画布，不进入安装进度', async () => {
  const f = fixture({ failSave: true });
  try { assert.equal(await f.view.__guanAutomaticUpdateRestart(url), false); assert.ok(f.calls.includes('flush')); assert.equal(f.calls.includes('close'), false); assert.equal(f.calls.some(v => Array.isArray(v)), false); }
  finally { f.cleanup(); }
});
test('跨页通知须核实管理器等待态，源码模式停止兜底轮询', async () => {
  for (const state of ['staged', 'source-development']) {
    const f = fixture({ state });
    try { assert.equal(await f.view.__guanAutomaticUpdateRestart(url), false); assert.equal(f.panels.length, 0); if (state === 'source-development') assert.equal(f.intervals.size, 0); }
    finally { f.cleanup(); }
  }
});
test('拒绝外部/无令牌进度地址，卸载后不再释放授权', async () => {
  const f = fixture();
  try {
    await f.view.__guanAutomaticUpdateRestart('https://example.com/');
    assert.equal(f.calls.includes('flush'), false);
    f.cleanup(); assert.equal(await f.view.__guanAutomaticUpdateRestart(url), false);
    assert.equal(f.calls.includes('close'), false);
  } finally { f.cleanup(); }
});
