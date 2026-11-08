import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { openWorkspace, restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createDataClient } from '../扩展功能/本机存储/浏览器适配.mjs';
import { createBackupCoordinator } from '../扩展功能/本机服务/自动备份.mjs';
import { 数据服务后继SHA256, 数据服务历史SHA256, 数据服务前态已登记 } from '../上游适配/SQLite数据服务媒体读取后继批准.mjs';
import { 加载写入协调预审服务, 构建写入协调候选, 写入协调服务候选, 服务路径 } from './预审SQLite写入协调.mjs';

const roots = [], origin = 'http://localhost:43121', code = expected => error => error.code === expected;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate) { const deadline = Date.now() + 3_000; while (!predicate()) { assert.ok(Date.now() < deadline, '等待服务边界状态超时'); await sleep(5); } }
function temp() { const root = mkdtempSync(join(tmpdir(), 'guan-stage6-write-gate-')); roots.push(root); return root; }
const value = title => ({ id: 'demo', title, nodes: [], connections: [] });
const input = (title = '协调保存', expectedRevision = 0, operationId = randomUUID()) => ({ collection: 'canvas', id: 'demo', value: value(title), expectedRevision, operationId, mediaIds: [] });

test('数据服务只接受历史前态或明确登记的媒体读取后继，未知SHA拒绝', () => {
  assert.equal(数据服务前态已登记(数据服务历史SHA256), true);
  assert.equal(数据服务前态已登记(数据服务后继SHA256), true);
  assert.equal(数据服务前态已登记('unknown-data-service-sha'), false);
});

test('当前数据服务后继前态可构建内存协调候选，历史写入协调快照不变', () => {
  const jsonPath = new URL('../上游适配/待审查/SQLite写入协调.json', import.meta.url);
  const patchPath = new URL('../上游适配/待审查/SQLite写入协调.patch', import.meta.url);
  const json = readFileSync(jsonPath), patch = readFileSync(patchPath);
  const delta = 构建写入协调候选();
  assert.equal(createHash('sha256').update(delta.get(服务路径).原文).digest('hex'), 数据服务后继SHA256);
  // 后继前态已经包含完整写入协调接线，预审候选直接复用已登记源码，避免重复套补丁。
  assert.equal(delta.get(服务路径).原文, delta.get(服务路径).产物);
  assert.deepEqual(readFileSync(jsonPath), json);
  assert.deepEqual(readFileSync(patchPath), patch);
});

async function fixture(options = {}) {
  const root = temp(), store = openWorkspace({ dataRoot: root, initialize: true });
  let time = Date.now(), hold = false, failBackup = false;
  const entered = deferred(), release = deferred();
  const { startDataService } = await 加载写入协调预审服务();
  const workspace = { ...store, async createBackup() { const receipt = await store.createBackup(); if (hold) { entered.resolve(receipt); await release.promise; } if (failBackup) throw Error('/synthetic/private-backup-failure'); return receipt; } };
  const service = await startDataService({ workspace, allowedOrigins: [origin], now: () => time, ...options });
  const session = service.issueSession(origin), base = `/v1/workspaces/${store.workspaceId}`;
  const transport = (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
  const client = createDataClient({ url: service.url, session, fetchImpl: transport });
  const call = (path, init = {}) => fetch(service.url + path, { ...init, headers: { Origin: origin, Authorization: `Bearer ${session.token}`, 'X-Guan-CSRF': session.csrf, ...init.headers } });
  const put = (write, extra = {}) => call(base + '/documents/canvas/demo', { method: 'PUT', body: JSON.stringify({ value: write.value, expectedRevision: write.expectedRevision, operationId: write.operationId, mediaIds: write.mediaIds }), ...extra, headers: { 'Content-Type': 'application/json', ...extra.headers } });
  return { root, store, service, session, client, call, put, base, entered, release,
    holdBackup() { hold = true; }, failBackup() { failBackup = true; }, tick(ms) { time += ms; },
    async close() { release.resolve(); client.close(); await service.close(); store.close(); } };
}

test('旧工作区确实在备份时拒绝写入；内存候选不改既有服务或批准快照', async () => {
  const delta = 构建写入协调候选(), before = delta.get(服务路径).原文;
  assert.throws(() => 写入协调服务候选(before.replace('rateLimit = 120', 'rateLimit = 121')), /锚点/);
  const root = temp(), store = openWorkspace({ dataRoot: root, initialize: true });
  try {
    const backup = store.createBackup();
    assert.throws(() => store.writeDocument(input()), code('workspace_busy')); await backup;
    await 加载写入协调预审服务();
    assert.equal(readFileSync(new URL('../扩展功能/本机服务/数据服务.mjs', import.meta.url), 'utf8'), before);
  } finally { store.close(); }
});

test('真实HTTP保存等待备份，读取不中断；ACK之后才saved，快照恢复不混入后续保存', async () => {
  const f = await fixture();
  try {
    await f.client.writeDocument(input('备份前')); f.holdBackup();
    const backup = f.service.createBackup(), receipt = await f.entered.promise;
    const second = input('备份后', 1), saving = f.client.writeDocument(second);
    await waitFor(() => f.service.getWriteStatus().queuedWrites === 1);
    assert.equal(f.client.getStatus().state, 'saving'); assert.equal(f.store.readDocument('canvas', 'demo').revision, 1);
    assert.equal((await f.client.readDocument('canvas', 'demo')).value.title, '备份前');
    assert.equal((await f.call('/health')).status, 200);
    f.release.resolve(); await backup; const ack = await saving;
    assert.equal(ack.revision, 2); assert.equal(f.client.getStatus().state, 'saved');
    assert.deepEqual(await f.client.writeDocument(second), ack); assert.equal(f.store.readDocument('canvas', 'demo').revision, 2);
    const targetRoot = join(temp(), '恢复快照'); restoreBackup({ backupRoot: receipt.path, targetRoot });
    const restored = openWorkspace({ dataRoot: targetRoot });
    try { assert.equal(restored.readDocument('canvas', 'demo').value.title, '备份前'); assert.equal(restored.readDocument('canvas', 'demo').revision, 1); }
    finally { restored.close(); }
  } finally { await f.close(); }
});

test('媒体上传同样等候备份结束，返回真实哈希ACK且不重复入库', async () => {
  const f = await fixture();
  try {
    f.holdBackup(); const backup = f.service.createBackup(); await f.entered.promise;
    const blob = new Blob(['synthetic-queued-media'], { type: 'application/octet-stream' });
    const id = createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
    const upload = f.client.writeMedia(blob); await waitFor(() => f.service.getWriteStatus().queuedWrites === 1);
    assert.throws(() => f.store.readMedia(id), code('media_not_found'));
    f.release.resolve(); await backup; assert.equal((await upload).id, id);
    assert.equal(await (await f.client.readMedia(id)).text(), 'synthetic-queued-media');
    assert.equal((await f.client.writeMedia(blob)).id, id);
  } finally { await f.close(); }
});

test('排队超时不会迟到提交，同一operationId显式重试只新增一次', async () => {
  const f = await fixture({ writeOptions: { maxWait: 40 } });
  try {
    f.holdBackup(); const backup = f.service.createBackup(); await f.entered.promise;
    const write = input('超时后重试');
    const response = await f.put(write); assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'write_wait_timeout');
    assert.equal(f.store.readDocument('canvas', 'demo'), null);
    f.release.resolve(); await backup; await waitFor(() => f.service.getWriteStatus().state === 'idle');
    assert.equal(f.store.readDocument('canvas', 'demo'), null);
    const ack = await (await f.put(write)).json(); assert.equal(ack.persisted, true); assert.equal(ack.revision, 1);
    assert.deepEqual(await (await f.put(write)).json(), ack); assert.equal(f.store.readDocument('canvas', 'demo').revision, 1);
  } finally { await f.close(); }
});

test('真实HTTP队列满时拒绝额外保存；已接收保存不丢、被拒绝内容不迟到执行', async () => {
  const f = await fixture({ writeOptions: { maxQueued: 1 } });
  try {
    f.holdBackup(); const backup = f.service.createBackup(); await f.entered.promise;
    const accepted = f.put(input('已接收')); await waitFor(() => f.service.getWriteStatus().queuedWrites === 1);
    const rejected = await f.put(input('没有接收', 1));
    assert.equal(rejected.status, 503); assert.equal((await rejected.json()).error.code, 'write_queue_full');
    f.release.resolve(); await backup; assert.equal((await accepted).status, 200);
    await waitFor(() => f.service.getWriteStatus().state === 'idle');
    assert.equal(f.store.readDocument('canvas', 'demo').revision, 1); assert.equal(f.store.readDocument('canvas', 'demo').value.title, '已接收');
  } finally { await f.close(); }
});

test('等待中的重复operationId按FIFO返回相同ACK，不生成重复修订', async () => {
  const f = await fixture();
  try {
    f.holdBackup(); const backup = f.service.createBackup(); await f.entered.promise;
    const write = input('同一保存'), first = f.put(write); await waitFor(() => f.service.getWriteStatus().queuedWrites === 1);
    const second = f.put(write); await waitFor(() => f.service.getWriteStatus().queuedWrites === 2);
    f.release.resolve(); await backup;
    const responses = await Promise.all([first, second]); assert.deepEqual(responses.map(response => response.status), [200, 200]);
    assert.deepEqual(await responses[0].json(), await responses[1].json()); assert.equal(f.store.readDocument('canvas', 'demo').revision, 1);
  } finally { await f.close(); }
});

test('浏览器连接在等待中关闭会撤销排队操作，不在断开后悄悄写入', async () => {
  const f = await fixture();
  try {
    f.holdBackup(); const backup = f.service.createBackup(); await f.entered.promise;
    const cancellation = new AbortController(), write = input('取消保存');
    const pending = f.put(write, { signal: cancellation.signal }); const rejected = assert.rejects(pending, error => error.name === 'AbortError');
    await waitFor(() => f.service.getWriteStatus().queuedWrites === 1); cancellation.abort(); await rejected;
    await waitFor(() => f.service.getWriteStatus().queuedWrites === 0); f.release.resolve(); await backup;
    assert.equal(f.store.readDocument('canvas', 'demo'), null);
    assert.equal((await f.put(write)).status, 200);
  } finally { await f.close(); }
});

test('等待期间撤销或过期的会话在执行前再次拒绝，不借排队延长权限', async () => {
  for (const type of ['revoke', 'expire']) {
    const f = await fixture({ sessionTTL: 60_000 });
    try {
      f.holdBackup(); const backup = f.service.createBackup(); await f.entered.promise;
      const pending = f.put(input(type)); await waitFor(() => f.service.getWriteStatus().queuedWrites === 1);
      if (type === 'revoke') f.service.revokeSession(f.session.token); else f.tick(60_000);
      f.release.resolve(); await backup; const response = await pending;
      assert.equal(response.status, 401); assert.equal((await response.json()).error.code, 'session_denied'); assert.equal(f.store.readDocument('canvas', 'demo'), null);
    } finally { await f.close(); }
  }
});

test('备份等待不放松Origin/会话/CSRF，备份与授权HTTP入口仍不存在', async () => {
  const f = await fixture();
  try {
    f.holdBackup(); const backup = f.service.createBackup(); await f.entered.promise;
    for (const [headers, status, expected] of [[{ Origin: 'http://evil.invalid' }, 403, 'origin_denied'], [{ Authorization: '' }, 401, 'session_denied'], [{ 'X-Guan-CSRF': '' }, 403, 'csrf_denied']]) {
      const response = await f.put(input(), { headers }); assert.equal(response.status, status); assert.equal((await response.json()).error.code, expected);
    }
    for (const path of ['/backup', '/authorize', '/renew']) assert.equal((await f.call(path)).status, 404);
    assert.equal(f.service.getWriteStatus().queuedWrites, 0); f.release.resolve(); await backup;
  } finally { await f.close(); }
});

test('自动备份失败暂停调度但释放写入闸门；用户的排队保存仍真实落盘', async () => {
  const f = await fixture();
  const automatic = createBackupCoordinator({ workspaceId: f.store.workspaceId, createBackup: () => f.service.createBackup() });
  try {
    await automatic.start(); f.holdBackup(); f.failBackup();
    const backup = automatic.request(), rejected = assert.rejects(backup, code('backup_failed')); await f.entered.promise;
    const saving = f.client.writeDocument(input('失败备份后的保存')); await waitFor(() => f.service.getWriteStatus().queuedWrites === 1);
    f.release.resolve(); await rejected; assert.equal((await saving).persisted, true);
    assert.equal(automatic.getStatus().state, 'error'); assert.equal(automatic.getStatus().nextAttemptAt, null);
    assert.equal(f.store.readDocument('canvas', 'demo').value.title, '失败备份后的保存');
    assert.doesNotMatch(JSON.stringify(automatic.getStatus()), /private-backup-failure/);
  } finally { await automatic.stop(); await f.close(); }
});

test('关闭服务等待已进入的备份并拒绝排队写入；不关闭工作区或强杀其他服务', async () => {
  const f = await fixture();
  try {
    f.holdBackup(); const backup = f.service.createBackup(); await f.entered.promise;
    const pending = f.put(input('关闭中')); await waitFor(() => f.service.getWriteStatus().queuedWrites === 1);
    let finished = false; const closing = f.service.close(); closing.then(() => { finished = true; });
    assert.equal(f.service.close(), closing);
    const response = await pending; assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'write_gate_closed');
    assert.equal(finished, false); f.release.resolve(); await backup; await closing;
    assert.equal(f.store.readDocument('canvas', 'demo'), null); assert.equal(f.service.getWriteStatus().state, 'closed');
    assert.equal(existsSync(join(f.root, '.实例锁.json')), true, '服务关闭不能冒充工作区已关闭');
  } finally { await f.close(); }
});

test.after(() => console.log(JSON.stringify({ syntheticWriteGateRoots: roots, retainedForInspection: true, candidateOnly: true, real3100Untouched: true })));
