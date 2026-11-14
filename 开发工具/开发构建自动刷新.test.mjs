import test from 'node:test';
import assert from 'node:assert/strict';
import { bindDevelopmentReload } from '../扩展功能/本机存储/开发构建自动刷新.mjs';

function fixture({ development = true, flush = async () => {} } = {}) {
  const timers = new Map(), events = new Map(), streams = [], trace = [];
  const root = { inert: false };
  let ready = true, dialog = false, downloading = false;
  const view = {
    document: { activeElement: null,
      querySelector: selector => selector.startsWith('meta') ? development ? { getAttribute: () => 'a'.repeat(64) } : null : downloading ? {} : null,
      querySelectorAll: () => [{ getClientRects: () => dialog ? [1] : [] }],
      getElementById: () => root,
      createElement: () => ({ setAttribute() {}, style: {}, remove() { trace.push('remove-warning'); } }),
      body: { append() { trace.push('warning'); } } },
    __guanReadUpdateState: () => ({ ready }),
    EventSource: class { constructor(path) { assert.equal(path, '/__guan_dev/events'); streams.push(this); } close() { this.closed = true; } },
    setTimeout: (fn, ms) => { const id = Symbol(); timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name),
    location: { reload() { trace.push('reload'); } },
  };
  const cleanup = bindDevelopmentReload({ view, flush: async () => { assert.equal(root.inert, true); trace.push('flush'); await flush(); trace.push('saved'); } });
  const notify = version => streams[0]?.onmessage({ data: JSON.stringify({ version }) });
  const tick = async () => { const first = timers.entries().next().value; if (!first) return; timers.delete(first[0]); await first[1].fn(); };
  return { view, streams, trace, root, timers, events, cleanup, notify, tick,
    setReady: value => ready = value, setDialog: value => dialog = value, setDownloading: value => downloading = value };
}

test('仅开发版订阅通知；当前版本、无效消息不刷新，同一批新构建只保存刷新一次', async () => {
  const customer = fixture({ development: false }); assert.equal(customer.streams.length, 0); customer.cleanup();
  const f = fixture();
  try {
    f.notify('a'.repeat(64)); f.notify('invalid'); assert.equal(f.timers.size, 0);
    f.streams[0].onmessage({ data: 'bad' }); assert.equal(f.timers.size, 0);
    f.notify('b'.repeat(64)); f.notify('c'.repeat(64)); assert.equal(f.timers.size, 1);
    await f.tick(); assert.deepEqual(f.trace, ['flush', 'saved', 'reload']);
    f.notify('d'.repeat(64)); await f.tick(); assert.equal(f.trace.filter(x => x === 'reload').length, 1);
  } finally { f.cleanup(); }
});

test('输入、弹窗、按住鼠标和生成任务期间等待，结束后保存并自动刷新', async () => {
  const f = fixture();
  try {
    f.view.document.activeElement = { tagName: 'TEXTAREA' };
    f.notify('b'.repeat(64)); await f.tick(); assert.deepEqual(f.trace, []);
    f.view.document.activeElement = null; f.setDialog(true); await f.tick(); assert.deepEqual(f.trace, []);
    f.setDialog(false); f.events.get('pointerdown')({ type: 'pointerdown' }); await f.tick(); assert.deepEqual(f.trace, []);
    f.events.get('pointerup')({ type: 'pointerup' }); f.setReady(false); await f.tick(); assert.deepEqual(f.trace, []);
    f.setReady(true); await f.tick(); assert.deepEqual(f.trace, ['flush', 'saved', 'reload']);
  } finally { f.cleanup(); }
});

test('所选文件打包期间等待，下载完成后再保存刷新', async () => {
  const f = fixture();
  try {
    f.setDownloading(true); f.notify('b'.repeat(64)); await f.tick(); assert.deepEqual(f.trace, []);
    f.setDownloading(false); await f.tick(); assert.deepEqual(f.trace, ['flush', 'saved', 'reload']);
  } finally { f.cleanup(); }
});

test('中文输入法未结束不刷新；保存失败保留编辑并自动重试，确认持久化后才刷新', async () => {
  let calls = 0;
  const f = fixture({ flush: async () => { if (++calls === 1) throw Error('合成保存断线'); } });
  try {
    f.events.get('compositionstart')({ type: 'compositionstart' });
    f.notify('b'.repeat(64)); await f.tick(); assert.deepEqual(f.trace, []);
    f.events.get('compositionend')({ type: 'compositionend' });
    await f.tick(); assert.deepEqual(f.trace, ['flush', 'warning']); assert.equal(f.root.inert, false);
    assert.equal([...f.timers.values()][0].ms, 2000);
    await f.tick(); assert.deepEqual(f.trace, ['flush', 'warning', 'flush', 'saved', 'remove-warning', 'reload']);
  } finally { f.cleanup(); }
});

test('保存未完成时不刷新；页面离开关闭连接、计时器和事件，不在异步排空后刷新', async () => {
  let finish;
  const f = fixture({ flush: () => new Promise(resolve => { finish = resolve; }) });
  f.notify('b'.repeat(64)); const checking = f.tick();
  assert.deepEqual(f.trace, ['flush']);
  f.cleanup(); finish(); await checking;
  assert.deepEqual(f.trace, ['flush', 'saved']); assert.equal(f.root.inert, false);
  assert.equal(f.streams[0].closed, true); assert.equal(f.timers.size, 0); assert.equal(f.events.size, 0);
});
