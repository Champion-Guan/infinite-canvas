import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createBackupCoordinator } from '../扩展功能/本机服务/自动备份.mjs';
import { openWorkspace, restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';

const roots = [], code = expected => error => error.code === expected;
function temp() { const root = mkdtempSync(join(tmpdir(), 'guan-stage6-backup-')); roots.push(root); return root; }
function fixture(createBackup, overrides = {}) {
  let time = Date.now(), timerId = 0;
  const timers = new Map(), workspaceId = randomUUID(), statuses = [];
  const coordinator = createBackupCoordinator({ workspaceId, automatic: true, createBackup: createBackup ?? (async () => ({ workspaceId, path: '/synthetic/' + randomUUID(), documentCount: 1, mediaCount: 0 })),
    now: () => time, interval: 60_000, schedule(fn, delay) { const id = ++timerId; timers.set(id, { at: time + delay, fn }); return id; }, cancel(id) { timers.delete(id); },
    onStatus: value => statuses.push(value), ...overrides });
  async function tick(ms) { time += ms; for (const [id, entry] of [...timers]) if (entry.at <= time) { timers.delete(id); entry.fn(); } await new Promise(resolve => setImmediate(resolve)); }
  return { coordinator, timers, statuses, tick, now: () => time, workspaceId };
}

test('自动备份默认未启动；校验工作区/周期/时钟；启动先完成首份快照', async () => {
  for (const bad of [{ workspaceId: 'bad' }, { interval: 0 }, { interval: 59_999 }, { interval: 86_400_001 }, { now: () => NaN }])
    assert.throws(() => fixture(undefined, bad), error => ['invalid_backup_config', 'invalid_clock'].includes(error.code));
  const f = fixture();
  assert.equal(f.coordinator.getStatus().state, 'stopped'); assert.equal(f.timers.size, 0);
  assert.throws(() => f.coordinator.request(), code('backup_not_running'));
  const task = f.coordinator.start(); assert.equal(f.coordinator.getStatus().state, 'backing-up');
  const receipt = await task;
  assert.equal(receipt.reason, 'startup'); assert.equal(receipt.workspaceId, f.workspaceId);
  assert.equal(receipt.completedAt, f.now()); assert.equal(f.coordinator.getStatus().state, 'ready'); assert.equal(f.timers.size, 1);
  await f.coordinator.start(); assert.equal(f.coordinator.getStatus().attempts, 1);
  receipt.reason = 'mutated'; const state = f.coordinator.getStatus(); state.lastBackup.reason = 'mutated';
  assert.equal(f.coordinator.getStatus().lastBackup.reason, 'startup');
  await f.coordinator.stop(); assert.equal(f.timers.size, 0);
});

test('首份快照失败阻止启动、不定时重试；错误不泄露原始路径或秘密', async () => {
  const f = fixture(async () => { throw Error('/private/synthetic-path?secret=synthetic-value'); });
  await assert.rejects(f.coordinator.start(), code('backup_failed'));
  const state = f.coordinator.getStatus(); assert.equal(state.state, 'error'); assert.equal(state.running, false); assert.equal(state.lastBackup, null);
  assert.equal(f.timers.size, 0); assert.doesNotMatch(JSON.stringify(state), /synthetic-path|synthetic-value/);
  await f.tick(120_000); assert.equal(f.coordinator.getStatus().attempts, 1);
  await f.coordinator.stop();
});

test('并发手动/维护/定时请求合并；慢备份不重叠，完成后才重新计时', async () => {
  let unblock, markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const gate = new Promise(resolve => { unblock = resolve; });
  let calls = 0, blocked = false;
  const f = fixture(async () => { calls++; if (blocked) { markStarted(); await gate; } return { workspaceId: f.workspaceId, path: '/synthetic/' + randomUUID(), documentCount: calls, mediaCount: 0 }; });
  await f.coordinator.start(); blocked = true;
  const first = f.coordinator.request('before-maintenance');
  await started;
  const second = f.coordinator.request('manual'); assert.equal(first, second); assert.equal(f.timers.size, 0);
  await f.tick(180_000); assert.equal(calls, 2); assert.equal(f.coordinator.getStatus().lastBackup.documentCount, 1);
  unblock(); const receipt = await first;
  assert.equal(receipt.documentCount, 2); assert.equal(receipt.reason, 'before-maintenance');
  assert.equal(f.coordinator.getStatus().nextAttemptAt, f.now() + 60_000);
  blocked = false; await f.tick(60_000); assert.equal(calls, 3); assert.equal(f.coordinator.getStatus().lastBackup.reason, 'periodic');
  await f.coordinator.stop();
});

test('定时失败保留上一份成功回执并暂停；手动恢复成功后重启计时', async () => {
  let fail = false;
  const f = fixture(async () => { if (fail) throw Object.assign(Error('synthetic raw IO'), { code: 'insufficient_space' }); return { workspaceId: f.workspaceId, path: '/synthetic/' + randomUUID(), documentCount: 2, mediaCount: 1 }; });
  const first = await f.coordinator.start(); fail = true;
  await f.tick(60_000);
  assert.equal(f.coordinator.getStatus().error.code, 'insufficient_space'); assert.deepEqual(f.coordinator.getStatus().lastBackup, first); assert.equal(f.timers.size, 0);
  await f.tick(3_600_000); assert.equal(f.coordinator.getStatus().attempts, 2);
  fail = false; await f.coordinator.request();
  assert.equal(f.coordinator.getStatus().state, 'ready'); assert.equal(f.coordinator.getStatus().error, null); assert.equal(f.timers.size, 1);
  await f.coordinator.stop();
});

test('停止必须等在途备份结束，不关闭工作区、不创建下一次定时任务', async () => {
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  let calls = 0;
  const f = fixture(async () => { calls++; if (calls === 2) await gate; return { workspaceId: f.workspaceId, path: '/synthetic/' + randomUUID(), documentCount: 0, mediaCount: 0 }; });
  await f.coordinator.start(); const backup = f.coordinator.request(); let stopped = false;
  const stop = f.coordinator.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, false);
  assert.throws(() => f.coordinator.start(), code('backup_stopping')); assert.throws(() => f.coordinator.request(), code('backup_not_running'));
  unblock(); await backup; await stop;
  assert.equal(stopped, true); assert.equal(f.coordinator.getStatus().state, 'stopped'); assert.equal(f.timers.size, 0);
  await f.tick(120_000); assert.equal(calls, 2);
});

test('错误或跨工作区的备份回执不能发布成功，订阅者异常不改变结果', async () => {
  for (const changes of [{ workspaceId: randomUUID() }, { path: '../outside' }, { path: '/synthetic/not-a-backup' }, { documentCount: -1 }, { mediaCount: NaN }]) {
    const f = fixture(async () => ({ workspaceId: f.workspaceId, path: '/synthetic/' + randomUUID(), documentCount: 0, mediaCount: 0, ...changes }), { onStatus: () => { throw Error('synthetic observer'); } });
    await assert.rejects(f.coordinator.start(), code('invalid_backup_receipt'));
    assert.equal(f.coordinator.getStatus().lastBackup, null); await f.coordinator.stop();
  }
});

test('调度器创建失败不能冒充已就绪，保留已完成快照摘要供诊断', async () => {
  const f = fixture(undefined, { schedule: () => { throw Error('synthetic timer failure'); } });
  await assert.rejects(f.coordinator.start(), code('backup_failed'));
  const status = f.coordinator.getStatus(); assert.equal(status.state, 'error'); assert.equal(status.running, false);
  assert.equal(status.lastBackup.reason, 'startup'); assert.equal(status.nextAttemptAt, null);
  await f.coordinator.stop();
});

test('真实SQLite自动快照可完整恢复文档和媒体；保留历次备份及0600/0700权限', async () => {
  let noSpace = false;
  const root = temp(), store = openWorkspace({ dataRoot: root, initialize: true, availableBytes: () => noSpace ? 0 : 1e12 });
  const f = fixture(() => store.createBackup(), { workspaceId: store.workspaceId });
  const media = store.writeMedia(Buffer.from('synthetic-auto-backup-media'), 'application/octet-stream');
  const value = { id: 'canvas-a', title: '自动备份第一版', nodes: [], connections: [] };
  const put = (title, revision) => store.writeDocument({ collection: 'canvas', id: value.id, value: { ...value, title }, mediaIds: [media.id], expectedRevision: revision, operationId: randomUUID() });
  try {
    put(value.title, 0); const first = await f.coordinator.start();
    put('自动备份第二版', 1); const second = await f.coordinator.request('before-maintenance');
    const folder = join(root, '备份'); assert.deepEqual(readdirSync(folder).sort(), [first.backupId, second.backupId].sort());
    assert.doesNotMatch(JSON.stringify(f.coordinator.getStatus()), new RegExp(root));
    for (const [receipt, title] of [[first, value.title], [second, '自动备份第二版']]) {
      const backupRoot = join(folder, receipt.backupId), targetRoot = join(temp(), '恢复工作区');
      assert.equal(statSync(backupRoot).mode & 0o777, 0o700); assert.equal(statSync(join(backupRoot, '清单.json')).mode & 0o777, 0o600);
      restoreBackup({ backupRoot, targetRoot }); const restored = openWorkspace({ dataRoot: targetRoot });
      try { assert.equal(restored.readDocument('canvas', value.id).value.title, title); assert.deepEqual(restored.readMedia(media.id).bytes, Buffer.from('synthetic-auto-backup-media')); }
      finally { restored.close(); }
    }
    const before = readdirSync(folder); noSpace = true;
    await assert.rejects(f.coordinator.request(), code('insufficient_space'));
    assert.deepEqual(readdirSync(folder), before); assert.equal(store.readDocument('canvas', value.id).revision, 2);
    assert.equal(JSON.parse(readFileSync(join(root, '.工作区.json'))).workspaceId, store.workspaceId);
  } finally { await f.coordinator.stop(); store.close(); }
});

test('关闭自动备份时启动、定时及维护均不创建副本，显式手动备份仍可使用', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { workspaceId: f.workspaceId, path: '/synthetic/' + randomUUID(), documentCount: 0, mediaCount: 0 }; }, { automatic: false });
  await f.coordinator.start();
  assert.equal(calls, 0); assert.equal(f.timers.size, 0); assert.equal(f.coordinator.getStatus().automatic, false);
  await f.tick(86_400_000); await f.coordinator.request('periodic');
  assert.equal(calls, 0);
  await f.coordinator.request('manual'); await f.coordinator.request('before-maintenance');
  assert.equal(calls, 1); assert.equal(f.timers.size, 0); assert.equal(f.coordinator.getStatus().nextAttemptAt, null);
  await f.coordinator.stop();
});

test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
