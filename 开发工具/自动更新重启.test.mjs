import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAutomaticUpdateRestart } from '../扩展功能/软件更新/自动更新重启.mjs';
import { createIdleUpgradeCoordinator } from '../扩展功能/软件更新/智能升级协调.mjs';

const url = 'http://127.0.0.1:12345/' + 'a'.repeat(48) + '/';
function fixture({ failSave = false, failClose = false, state = 'awaiting-browser-exit' } = {}) {
  const calls = [], intervals = new Set(), listeners = {}, panels = [];
  class Channel { postMessage() { calls.push('broadcast'); } close() { calls.push('channel-close'); } }
  function element() { return { children: [], listeners: {}, setAttribute() {}, append(child) { this.children.push(child); }, showModal() {},
    addEventListener(type, callback) { this.listeners[type] = callback; }, close() {}, remove() {} }; }
  const view = { BroadcastChannel: Channel, document: { createElement: element, body: { append: value => panels.push(value) } },
    location: { replace: value => calls.push(['navigate', value]) }, setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(fn) { intervals.delete(fn); },
    addEventListener(type, fn) { listeners[type] = fn; } };
  const cleanup = bindAutomaticUpdateRestart({ view, updatePort: { async request(operation) { calls.push(operation); return operation === 'status' ? { install: { state } } : { url }; } },
    flush: async () => { calls.push('flush'); if (failSave) throw Error('未保存'); }, host: { async close() {
      calls.push('close');
      if (failClose) { failClose = typeof failClose === 'number' ? failClose - 1 : false; throw Object.assign(Error('合成连接中断'), { code: 'authorization_connection_failed' }); }
    } } });
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
test('退出回执丢失时仅重试原页面释放，不重复保存或停在旧页', async () => {
  const f = fixture({ failClose: true });
  try {
    assert.equal(await f.view.__guanAutomaticUpdateRestart(url), true);
    assert.equal(f.calls.filter(call => call === 'flush').length, 1);
    assert.equal(f.calls.filter(call => call === 'close').length, 2);
    assert.deepEqual(f.calls.at(-1), ['navigate', url]);
  } finally { f.cleanup(); }
});
test('持续断线后可原地继续退出，不要求重新保存或重新授权', async () => {
  const f = fixture({ failClose: 2 });
  try {
    assert.equal(await f.view.__guanAutomaticUpdateRestart(url), false);
    const button = f.panels.at(-1).children.find(child => child.textContent === '重试继续安装');
    assert.ok(button); button.listeners.click();
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.filter(call => call === 'flush').length, 1);
    assert.equal(f.calls.filter(call => call === 'close').length, 3);
    assert.deepEqual(f.calls.at(-1), ['navigate', url]);
  } finally { f.cleanup(); }
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

function coordinatedPages({ failSave = false, running = 0, beforeFlush = async () => {} } = {}) {
  let time = 0, approved = false, active = running;
  const calls = [], pages = ['one', 'two'], preferences = { autoInstall: true };
  const updates = {
    preferences: async () => preferences,
    status: async () => ({ currentVersion: '2.0.0-beta.21', preferences,
      download: { state: 'verified', version: '2.0.0-beta.22' },
      install: { allowed: true, state: approved ? 'awaiting-browser-exit' : 'staged', targetVersion: '2.0.0-beta.22', canApprove: !approved } }),
    approve: async () => { calls.push('approve'); approved = true; },
    defer: async () => { approved = false; },
  };
  const coordinator = createIdleUpgradeCoordinator({ updates, pages: () => pages, now: () => time,
    generation: { getStatus: () => ({ running: active }), assertCanUpdate: async () => {} } });
  const clients = pages.map(id => {
    const listeners = new Map(), intervals = new Set(), panels = [];
    function element() {
      return { children: [], listeners: {}, setAttribute() {}, append(child) { this.children.push(child); },
        showModal() { this.open = true; }, addEventListener(type, fn) { this.listeners[type] = fn; }, close() { this.open = false; }, remove() { this.removed = true; } };
    }
    const view = { document: { createElement: element, body: { append: panel => panels.push(panel) } },
      __guanReadUpdateState: () => ({ ready: true }),
      location: { replace: value => { calls.push([id, 'navigate', value]); listeners.get('pagehide')?.(); } },
      setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(fn) { intervals.delete(fn); },
      addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); } };
    const snapshot = async () => ({ ...await updates.status(), install: { ...(await updates.status()).install, coordination: coordinator.status() } });
    const cleanup = bindAutomaticUpdateRestart({ view, now: () => time, idleMs: 60_000,
      updatePort: { async request(operation, input) {
        if (operation === 'activity') { await coordinator.activity(id, input); return snapshot(); }
        if (operation === 'progress-window') return { url };
        if (operation === 'defer') { await coordinator.defer(); return snapshot(); }
        return snapshot();
      } },
      flush: async () => { calls.push([id, 'flush']); await beforeFlush(id); if (failSave && id === 'two') throw Error('保存失败'); },
      host: { async close() { calls.push([id, 'close']); pages.splice(pages.indexOf(id), 1); } } });
    return { view, listeners, intervals, panels, cleanup,
      async poll() { for (const fn of intervals) fn(); for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); } };
  });
  return { clients, calls, coordinator, advance: ms => { time += ms; }, finishGeneration: () => { active = 0; } };
}
test('两页真实协调：活动和生成期间不打断，全部空闲并保存后自动返回进度', async () => {
  const f = coordinatedPages({ running: 1 });
  try {
    f.advance(61_000);
    for (const client of f.clients) await client.poll();
    assert.equal(f.calls.includes('approve'), false);
    assert.equal(f.clients.some(client => client.panels.length), false);
    f.finishGeneration();
    f.clients[1].listeners.get('input')({ type: 'input' });
    f.advance(31_000);
    for (const client of f.clients) await client.poll();
    assert.equal(f.calls.includes('approve'), false);
    f.advance(61_000);
    for (let i = 0; i < 4; i++) { f.advance(3000); for (const client of f.clients) await client.poll(); }
    assert.equal(f.calls.filter(call => call === 'approve').length, 1);
    const approvedAt = f.calls.indexOf('approve');
    for (const id of ['one', 'two']) {
      assert.ok(f.calls.findIndex(call => Array.isArray(call) && call[0] === id && call[1] === 'flush') < approvedAt);
      assert.ok(f.calls.findIndex(call => Array.isArray(call) && call[0] === id && call[1] === 'close') > approvedAt);
      assert.ok(f.calls.some(call => Array.isArray(call) && call[0] === id && call[1] === 'navigate' && call[2] === url));
      const lastFlush = f.calls.findLastIndex(call => Array.isArray(call) && call[0] === id && call[1] === 'flush');
      assert.ok(lastFlush < approvedAt);
      assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === id && call[1] === 'close').length, 1);
    }
  } finally { f.clients.forEach(client => client.cleanup()); await f.coordinator.close(); }
});
test('保存尚在进行时选择稍后安装，不发送完成回执、不退出页面', async () => {
  let release;
  const f = coordinatedPages({ beforeFlush: id => id === 'two' ? new Promise(resolve => { release = resolve; }) : undefined });
  try {
    f.advance(61_000);
    for (const client of f.clients) await client.poll();
    f.advance(3000);
    for (const client of f.clients) await client.poll();
    assert.equal(typeof release, 'function');
    const panel = f.clients[1].panels.at(-1);
    panel.children.find(child => child.textContent === '稍后安装').listeners.click({ preventDefault() {} });
    release();
    for (let i = 0; i < 3; i++) { f.advance(3000); for (const client of f.clients) await client.poll(); }
    assert.equal(f.calls.includes('approve'), false);
    assert.equal(f.calls.some(call => Array.isArray(call) && ['close', 'navigate'].includes(call[1])), false);
    assert.equal(f.clients.some(client => client.panels.some(item => item.open)), false);
  } finally { release?.(); f.clients.forEach(client => client.cleanup()); await f.coordinator.close(); }
});
test('一个页面保存失败时，两页均不退出，准备面板解除并保留可重试状态', async () => {
  const f = coordinatedPages({ failSave: true });
  try {
    f.advance(61_000);
    for (let i = 0; i < 4; i++) { f.advance(3000); for (const client of f.clients) await client.poll(); }
    assert.equal(f.coordinator.status().reason, 'upgrade_save_failed');
    assert.equal(f.calls.includes('approve'), false);
    assert.equal(f.calls.some(call => Array.isArray(call) && ['close', 'navigate'].includes(call[1])), false);
    assert.equal(f.clients.some(client => client.panels.some(panel => panel.open)), false);
  } finally { f.clients.forEach(client => client.cleanup()); await f.coordinator.close(); }
});
test('已准备页面重新忙碌时撤回完成回执，其他页面不得提前退出', async () => {
  const f = coordinatedPages();
  try {
    f.advance(61_000);
    for (const client of f.clients) await client.poll();
    assert.ok(f.calls.some(call => Array.isArray(call) && call[0] === 'two' && call[1] === 'flush'));
    f.clients[1].view.__guanReadUpdateState = () => ({ ready: false });
    f.advance(3000);
    await f.clients[1].poll(); await f.clients[0].poll();
    assert.equal(f.coordinator.status().reason, 'upgrade_waiting_activity');
    assert.equal(f.calls.includes('approve'), false);
    assert.equal(f.calls.some(call => Array.isArray(call) && call[1] === 'close'), false);
  } finally { f.clients.forEach(client => client.cleanup()); await f.coordinator.close(); }
});
