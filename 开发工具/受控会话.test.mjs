import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createSessionController } from '../扩展功能/本机服务/受控会话.mjs';
import { createRenewingDataClient } from '../扩展功能/本机存储/续期数据客户端.mjs';

const origin = 'http://localhost:43111';
const roots = [];
async function fixture(options = {}) {
  let time = Date.now();
  const timers = new Map(); let timerId = 0;
  const now = () => time;
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-session-')); roots.push(root);
  const store = openWorkspace({ dataRoot: root, initialize: true });
  const service = await startDataService({ workspace: store, allowedOrigins: [origin], now, sessionTTL: 60_000 });
  const controller = createSessionController({ service, origin, now, renewalWindow: 10_000, overlap: 5_000, lifetime: 180_000,
    schedule(fn, delay) { const id = ++timerId; timers.set(id, { at: time + delay, fn }); return id; }, cancel(id) { timers.delete(id); }, ...options });
  const port = controller.open();
  function tick(ms) { time += ms; for (const [id, entry] of timers) if (entry.at <= time) { timers.delete(id); entry.fn(); } }
  const transport = (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
  const client = config => createRenewingDataClient({ url: service.url, host: port, origin, now, renewalWindow: 10_000, fetchImpl: transport, ...config });
  const call = session => transport(service.url + '/health', { headers: { Authorization: 'Bearer ' + session.token } });
  return { root, store, service, controller, port, tick, client, transport, call, now, timers, async close() { controller.close(); await service.close(); store.close(); assert.equal(timers.size, 0); } };
}
const input = (title = '续期测试', revision = 0, operationId = randomUUID()) => ({ collection: 'canvas', id: 'demo', value: { id: 'demo', title, nodes: [], connections: [] }, expectedRevision: revision, operationId });
const code = expected => error => error.code === expected;

test('只允许精确本机Origin和受限配置；不提供HTTP匿名授权/续期接口', async () => {
  const f = await fixture();
  try {
    for (const bad of ['null', 'http://evil.invalid:43111', origin + '/', 'https://localhost:43111']) assert.throws(() => createSessionController({ service: f.service, origin: bad }), code('invalid_session_controller'));
    const session = f.port.initialize();
    for (const path of ['/authorize', '/session', '/renew']) {
      const response = await f.transport(f.service.url + path, { headers: { Authorization: 'Bearer ' + session.token } });
      assert.equal(response.status, 404); assert.equal((await response.json()).error.code, 'route_not_found');
    }
    assert.deepEqual(f.port.initialize(), session); assert.equal((await f.call(session)).status, 200);
  } finally { await f.close(); }
});

test('续期轮换令牌和CSRF，短暂保留旧在途授权，重试幂等且伪造/提前续期拒绝', async () => {
  const f = await fixture();
  try {
    const first = f.port.initialize();
    assert.throws(() => f.port.renew(first), code('renewal_not_due'));
    f.tick(51_000);
    for (const changes of [{ origin: 'http://localhost:43112' }, { workspaceId: randomUUID() }, { csrf: 'f'.repeat(64) }, { expiresAt: first.expiresAt + 1 }]) assert.throws(() => f.port.renew({ ...first, ...changes }), code('session_mismatch'));
    const next = f.port.renew(first);
    assert.notEqual(next.token, first.token); assert.notEqual(next.csrf, first.csrf);
    assert.equal(next.workspaceId, first.workspaceId); assert.equal(next.origin, origin);
    assert.equal((await f.call(first)).status, 200); assert.equal((await f.call(next)).status, 200);
    assert.deepEqual(f.port.renew(first), next);
    assert.throws(() => f.port.renew({ ...first, token: '0'.repeat(64) }), code('session_mismatch'));
    f.tick(5_001); assert.equal((await f.call(first)).status, 401); assert.equal((await f.call(next)).status, 200);
    f.port.close(); assert.equal((await f.call(next)).status, 401);
  } finally { await f.close(); }
});

test('会话过期不能复活；绝对期限或主动关闭撤销全部令牌并释放名额', async () => {
  const f = await fixture({ lifetime: 90_000, maxLeases: 1 });
  try {
    const first = f.port.initialize(); assert.throws(() => f.controller.open(), code('too_many_leases'));
    f.tick(51_000); const next = f.port.renew(first); assert.equal(next.expiresAt, f.now() + 39_000);
    f.tick(39_000); assert.equal((await f.call(next)).status, 401);
    assert.throws(() => f.port.renew(next), code('lease_expired'));
    const fresh = f.controller.open(), session = fresh.initialize();
    f.tick(60_000); assert.throws(() => fresh.initialize(), code('session_expired')); assert.throws(() => fresh.renew(session), code('session_expired'));
    fresh.close(); f.controller.close(); assert.throws(() => f.controller.open(), code('session_host_closed'));
  } finally { await f.close(); }
});

test('签发容量不足不撤销原会话，不伪造续期成功', async () => {
  const f = await fixture();
  try {
    const first = f.port.initialize(); f.tick(51_000);
    for (let i = 0; i < 63; i++) f.service.issueSession(origin);
    assert.throws(() => f.port.renew(first), code('too_many_sessions'));
    assert.deepEqual(f.port.initialize(), first); assert.equal((await f.call(first)).status, 200);
  } finally { await f.close(); }
});

test('并发初始化/续期各只一次；跨续期实际保存并从SQLite恢复', async () => {
  const f = await fixture();
  try {
    let initializes = 0, renewals = 0;
    const host = { initialize: async () => { initializes++; return f.port.initialize(); }, renew: async previous => { renewals++; return f.port.renew(previous); }, close: () => f.port.close() };
    const client = f.client({ host });
    await Promise.all(Array.from({ length: 6 }, () => client.readUsage())); assert.equal(initializes, 1);
    const first = await client.writeDocument(input('续期前')); assert.equal(first.revision, 1);
    f.tick(51_000); await Promise.all(Array.from({ length: 6 }, () => client.readUsage())); assert.equal(renewals, 1);
    assert.equal(client.getStatus().lastAck.operationId, first.operationId, '续期不丢失最后落盘ACK');
    const ack = await client.writeDocument(input('续期后', 1)); assert.equal(ack.revision, 2);
    assert.equal((await client.readDocument('canvas', 'demo')).value.title, '续期后');
    assert.equal(f.store.readDocument('canvas', 'demo').revision, 2);
    await client.close(); assert.equal(f.timers.size, 0);
  } finally { await f.close(); }
});

test('提交成功但响应丢失不自动重发；跨续期手动同ID重试只保存一次', async () => {
  const f = await fixture();
  try {
    let calls = 0, loseOnce = true;
    const client = f.client({ fetchImpl: async (url, init) => {
      const response = await f.transport(url, init);
      if (init.method === 'PUT') { calls++; if (loseOnce) { loseOnce = false; await response.arrayBuffer(); throw Error('synthetic response lost'); } }
      return response;
    } });
    const write = input('响应丢失');
    await assert.rejects(client.writeDocument(write), code('connection_failed')); assert.equal(calls, 1);
    assert.equal(f.store.readDocument('canvas', 'demo').revision, 1); assert.equal(client.getStatus().state, 'error');
    f.tick(51_000); await client.readUsage(); assert.equal(client.getStatus().state, 'error', '读取及续期不能清除未确认写入');
    assert.equal((await client.writeDocument(write)).operationId, write.operationId); assert.equal(calls, 2);
    assert.equal(f.store.readDocument('canvas', 'demo').revision, 1); assert.equal(client.getStatus().state, 'saved');
    await client.close();
  } finally { await f.close(); }
});

test('失效、跨工作区/Origin或伪造续期不得向业务API发出保存', async () => {
  for (const changes of [{ workspaceId: randomUUID() }, { origin: 'http://localhost:43112' }, { token: 'broken' }, { protocol: 'wrong' }, { expiresAt: 0 }]) {
    const f = await fixture();
    try {
      let requests = 0;
      const host = { initialize: () => f.port.initialize(), renew: previous => ({ ...f.port.renew(previous), ...changes }), close: () => f.port.close() };
      const client = f.client({ host, fetchImpl: (...args) => { requests++; return f.transport(...args); } });
      await client.readUsage(); f.tick(51_000);
      await assert.rejects(client.writeDocument(input()), code('invalid_session')); assert.equal(requests, 1);
      assert.equal(f.store.readDocument('canvas', 'demo'), null); assert.equal(client.getStatus().state, 'error');
    } finally { await f.close(); }
  }
});

test('休眠至过期不自动重新授权；失败状态阻止关闭', async () => {
  const f = await fixture();
  try {
    let initializes = 0, renewals = 0;
    const client = f.client({ host: { initialize: () => { initializes++; return f.port.initialize(); }, renew: previous => { renewals++; return f.port.renew(previous); }, close: () => f.port.close() } });
    await client.readUsage(); f.tick(60_000);
    await assert.rejects(client.writeDocument(input()), code('session_expired'));
    assert.equal(initializes, 1); assert.equal(renewals, 0); assert.equal(f.store.readDocument('canvas', 'demo'), null);
    await assert.rejects(client.close(), code('save_not_confirmed'));
  } finally { await f.close(); }
});

test('续期发生时已在途的保存不被关闭；待确认操作阻止关闭', async () => {
  const f = await fixture();
  try {
    let unblock, signal;
    const blocked = new Promise(resolve => { signal = resolve; });
    const gate = new Promise(resolve => { unblock = resolve; });
    const client = f.client({ fetchImpl: async (url, init) => {
      if (init.method === 'PUT') { signal(); await gate; }
      return f.transport(url, init);
    } });
    const write = client.writeDocument(input('在途保存'));
    await blocked; await assert.rejects(client.close(), code('save_not_confirmed'));
    f.tick(51_000); await client.readUsage(); unblock(); assert.equal((await write).revision, 1);
    assert.equal(client.getStatus().state, 'saved'); await client.close();
    await assert.rejects(client.readUsage(), code('client_closed'));
  } finally { await f.close(); }
});

test('调用后修改原对象不漂移；不可快照的数据在授权和发送前拒绝', async () => {
  const f = await fixture();
  try {
    const client = f.client(), write = input('调用瞬间的标题');
    const pending = client.writeDocument(write); write.value.title = '随后被修改'; write.operationId = randomUUID();
    const ack = await pending;
    assert.notEqual(ack.operationId, write.operationId); assert.equal(f.store.readDocument('canvas', 'demo').value.title, '调用瞬间的标题');
    await assert.rejects(client.writeDocument({ ...input(), value: { f() {} } }), code('invalid_document'));
    assert.equal(client.getStatus().state, 'error'); assert.equal(f.store.readDocument('canvas', 'demo').revision, 1);
  } finally { await f.close(); }
});

test('续期客户端本机Origin和无效时钟在请求前阻断', async () => {
  const f = await fixture();
  try {
    for (const bad of ['null', 'http://evil.invalid:43111', origin + '/']) assert.throws(() => f.client({ origin: bad }), code('invalid_session_client'));
    let requests = 0;
    const client = f.client({ now: () => NaN, fetchImpl: (...args) => { requests++; return f.transport(...args); } });
    await assert.rejects(client.readUsage(), code('invalid_clock')); assert.equal(requests, 0);
  } finally { await f.close(); }
});

test.after(() => console.log(JSON.stringify({ syntheticSessionRoots: roots, retainedForInspection: true })));


test('续期重试不延长绝对期限，更旧请求与已过期结果不能复活', async () => {
  const f = await fixture({ lifetime: 140_000 });
  try {
    const first = f.port.initialize(); f.tick(51_000); const next = f.port.renew(first);
    f.tick(51_000); const last = f.port.renew(next);
    assert.equal(last.expiresAt, first.expiresAt + 80_000);
    assert.throws(() => f.port.renew(first), code('session_mismatch'));
    assert.deepEqual(f.port.renew(next), last);
    f.tick(38_000); assert.throws(() => f.port.renew(next), code('lease_expired'));
    assert.equal((await f.call(last)).status, 401);
  } finally { await f.close(); }
});
