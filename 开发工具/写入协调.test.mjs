import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWriteCoordinator } from '../扩展功能/本机服务/写入协调.mjs';

const code = expected => error => error.code === expected;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  let time = 0, timerId = 0;
  const timers = new Map();
  const gate = createWriteCoordinator({ maxWait: 100, schedule(fn, delay) { const id = ++timerId; timers.set(id, { at: time + delay, fn }); return id; }, cancel(id) { timers.delete(id); }, ...options });
  async function tick(ms) { time += ms; for (const [id, item] of [...timers]) if (item.at <= time) { timers.delete(id); item.fn(); } await turn(); }
  return { gate, timers, tick };
}

test('写入与备份严格FIFO，等待先前提交；备份期间新写入稍后执行、不重叠', async () => {
  const f = fixture(), hold = deferred(), entered = deferred(), order = [];
  let active = 0, peak = 0;
  const operation = (label, delay) => async () => { peak = Math.max(peak, ++active); order.push(label + ':start'); if (delay) { entered.resolve(); await delay; } order.push(label + ':end'); active--; return label; };
  const first = f.gate.runWrite(operation('write-1', hold.promise));
  await entered.promise;
  const backup = f.gate.runBackup(operation('backup')), second = f.gate.runWrite(operation('write-2'));
  assert.deepEqual(order, ['write-1:start']); assert.equal(f.gate.getStatus().queuedBackups, 1); assert.equal(f.gate.getStatus().queuedWrites, 1);
  hold.resolve(); assert.deepEqual(await Promise.all([first, backup, second]), ['write-1', 'backup', 'write-2']);
  await f.gate.close(); assert.equal(peak, 1); assert.equal(f.timers.size, 0);
  assert.deepEqual(order, ['write-1:start', 'write-1:end', 'backup:start', 'backup:end', 'write-2:start', 'write-2:end']);
});

test('队列有界、排队超时移除操作，恢复后不发生迟到提交', async () => {
  const f = fixture({ maxQueued: 1 }), hold = deferred(); let commits = 0;
  const active = f.gate.runBackup(() => hold.promise);
  const queued = f.gate.runWrite(() => { commits++; });
  await assert.rejects(f.gate.runWrite(() => { commits++; }), code('write_queue_full'));
  const timedOut = assert.rejects(queued, code('write_wait_timeout')); await f.tick(100); await timedOut;
  assert.equal(f.gate.getStatus().queuedWrites, 0); assert.equal(f.timers.size, 0);
  hold.resolve(); await active; await f.gate.close(); assert.equal(commits, 0);
});

test('取消排队请求不会执行；已进入提交的操作不伪装成已取消', async () => {
  const f = fixture(), hold = deferred(), signal = new AbortController(); let commits = 0;
  const active = f.gate.runBackup(() => hold.promise);
  const queued = f.gate.runWrite(() => { commits++; }, { signal: signal.signal });
  const rejected = assert.rejects(queued, code('write_cancelled')); signal.abort(); await rejected;
  assert.equal(f.timers.size, 0); hold.resolve(); await active;
  const entered = deferred(), finish = deferred(), nextSignal = new AbortController();
  const committed = f.gate.runWrite(async () => { entered.resolve(); await finish.promise; commits++; return { persisted: true }; }, { signal: nextSignal.signal });
  await entered.promise; nextSignal.abort(); finish.resolve();
  assert.deepEqual(await committed, { persisted: true }); assert.equal(commits, 1); await f.gate.close();
});

test('关闭拒绝新任务与排队任务，等待已经进入的操作；重复关闭共享完成证明', async () => {
  const f = fixture(), hold = deferred();
  const active = f.gate.runBackup(() => hold.promise), queued = f.gate.runWrite(() => assert.fail('不得提交'));
  const rejected = assert.rejects(queued, code('write_gate_closed'));
  let closed = false; const closing = f.gate.close(); closing.then(() => { closed = true; });
  assert.equal(f.gate.close(), closing); await rejected; await turn(); assert.equal(closed, false);
  await assert.rejects(f.gate.runWrite(() => {}), code('write_gate_closed'));
  hold.resolve('snapshot-complete'); assert.equal(await active, 'snapshot-complete'); await closing;
  assert.equal(f.gate.getStatus().state, 'closed'); assert.equal(f.timers.size, 0);
});

test('操作失败不锁死后继；订阅异常不改变真实结果，状态不包含业务内容', async () => {
  const f = fixture({ onStatus() { throw Error('synthetic observer'); } });
  const fail = f.gate.runBackup(() => { throw Error('/synthetic/private-path'); });
  const next = f.gate.runWrite(() => 'committed');
  await assert.rejects(fail, /synthetic\/private-path/); assert.equal(await next, 'committed');
  assert.doesNotMatch(JSON.stringify(f.gate.getStatus()), /private-path|committed/); await f.gate.close();
});

test('无效配置、无效操作、预先取消和等待机制异常都不执行提交', async () => {
  for (const config of [{ maxQueued: 0 }, { maxQueued: 33 }, { maxWait: 0 }, { maxWait: 60_001 }, { onStatus: 1 }]) assert.throws(() => createWriteCoordinator(config), code('invalid_write_coordinator'));
  const f = fixture({ schedule() { throw Error('synthetic timer'); } }), hold = deferred();
  const active = f.gate.runBackup(() => hold.promise);
  await assert.rejects(f.gate.runWrite(null), code('invalid_write_operation'));
  await assert.rejects(f.gate.runWrite(() => assert.fail(), { signal: {} }), code('invalid_write_operation'));
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(f.gate.runWrite(() => assert.fail(), { signal: cancelled.signal }), code('write_cancelled'));
  await assert.rejects(f.gate.runWrite(() => assert.fail()), code('write_queue_unavailable'));
  assert.equal(f.gate.getStatus().queuedWrites, 0); hold.resolve(); await active; await f.gate.close();
});

test('多个备份保留各自FIFO位置，不合并成早于后续写入的旧快照', async () => {
  const f = fixture(), hold = deferred(); let revision = 0;
  const one = f.gate.runBackup(async () => { await hold.promise; return revision; });
  const write = f.gate.runWrite(() => ++revision), two = f.gate.runBackup(() => revision);
  hold.resolve(); assert.equal(await one, 0); assert.equal(await write, 1); assert.equal(await two, 1); await f.gate.close();
});
