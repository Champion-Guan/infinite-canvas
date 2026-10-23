import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { authorizeLocalStorage } from '../扩展功能/本机存储/本机授权客户端.mjs';
import { createRenewingDataClient } from '../扩展功能/本机存储/续期数据客户端.mjs';
import { createSessionController } from '../扩展功能/本机服务/可重连受控会话.mjs';
import { PROTOCOL, StorageError } from '../扩展功能/本机存储/协议.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const code = expected => error => error.code === expected;
async function fixture(t) {
  let time = Date.now(), prepare = () => client.ensureSession(), transport = next => next();
  const origin = 'http://localhost:3100', workspaceId = randomUUID(), requests = [], sessions = new Map();
  const calls = { authorize: 0, initialize: 0, renew: 0, reconnect: 0 };
  const controller = createSessionController({ origin, now: () => time, renewalWindow: 10_000, schedule: () => 0, cancel() {}, service: {
    issueSession() { const value = { protocol: PROTOCOL, workspaceId, origin, token: randomBytes(32).toString('hex'), csrf: randomBytes(32).toString('hex'), expiresAt: time + 60_000 }; sessions.set(value.token, value); return value; },
    revokeSession: token => sessions.delete(token),
  } });
  const port = controller.open(); t.after(() => controller.close());
  const fetchImpl = async (url, request) => {
    const path = new URL(url).pathname.split('/').at(-1), body = request.body ? JSON.parse(request.body) : null;
    requests.push({ path, body, headers: request.headers });
    if (path === 'authorize') { calls.authorize++; return Response.json({ protocol: 'guan-local-authorization.v1', origin, dataURL: 'http://127.0.0.1:49999', capability: 'a'.repeat(64), expiresAt: time + 8 * 60 * 60_000 }); }
    if (path === 'session') {
      if (body.operation in calls) calls[body.operation]++;
      return Response.json({ protocol: 'guan-local-authorization.v1', session: port[body.operation](body.session) });
    }
    return transport(() => {
      const session = port.initialize(); assert.ok(session.expiresAt > time);
      if (path === 'usage') return Response.json({ protocol: PROTOCOL, workspaceId, usage: 0, quota: null, contentBytes: 0, databases: [] });
      if (path === 'credentials') return Response.json({ format: 'guan-credentials.v1', ref: 'secret:' + 'b'.repeat(64) });
      const protocol = path === 'generation' ? 'guan-generation.v1' : path === 'network-proxy' ? 'guan-network-proxy.v1' : 'guan-local-authorization.v1';
      const result = body?.operation === 'submit' ? { ...body.task, state: 'accepted', applied: false } : { ok: true };
      return Response.json({ protocol, result });
    }, path, body);
  };
  let client;
  const auth = await authorizeLocalStorage({ code: 'c'.repeat(64), origin, now: () => time, fetchImpl, prepareSession: () => prepare() });
  client = createRenewingDataClient({ ...auth, origin, fetchImpl, now: () => time, autoReconnect: true, renewalWindow: 10_000 });
  return { auth, client, requests, calls, tick(ms) { time += ms; }, setPrepare(fn) { prepare = fn; }, setTransport(fn) { transport = fn; } };
}

test('四类业务与保存共用原会话，过期恢复一次，协议和凭据引用不变', async t => {
  const f = await fixture(t); await f.client.readUsage(); f.tick(60_000);
  await Promise.all([f.auth.secretPort.store('仅合成测试'), f.auth.updatePort.request('status'), f.auth.networkProxyPort.status(), f.auth.generationPort.list('product'), f.client.readUsage()]);
  assert.equal(f.calls.authorize, 1); assert.equal(f.calls.initialize, 1); assert.equal(f.calls.reconnect, 1);
  assert.equal(f.client.getStatus().state, 'idle');
  const generation = f.requests.find(item => item.path === 'generation');
  assert.equal(generation.headers['X-Guan-Generation-Protocol'], 'guan-generation.v1');
  assert.equal(f.requests.find(item => item.path === 'network-proxy').headers['X-Guan-Proxy-Protocol'], 'guan-network-proxy.v1');
});

test('续期窗口内先更新会话再发送业务，不重复兑换授权', async t => {
  const f = await fixture(t); await f.client.readUsage(); f.tick(50_001); await f.auth.updatePort.request('status');
  assert.equal(f.calls.renew, 1); assert.equal(f.calls.reconnect, 0); assert.equal(f.calls.authorize, 1);
});

test('准备失败时不发送业务，下一次调用仍可通过原会话恢复', async t => {
  const f = await fixture(t); f.setPrepare(() => { throw new StorageError('session_expired', '合成拒绝', 401); });
  await assert.rejects(f.auth.generationPort.list('product'), code('session_expired'));
  assert.equal(f.requests.filter(item => item.path === 'generation').length, 0);
  f.setPrepare(() => f.client.ensureSession()); await f.auth.generationPort.list('product');
  assert.equal(f.calls.initialize, 1); assert.equal(f.calls.authorize, 1);
});

test('等待恢复期间业务使用调用时快照，不受调用者修改', async t => {
  const f = await fixture(t), gate = deferred(), entered = deferred();
  f.setPrepare(async () => { entered.resolve(); await gate.promise; await f.client.ensureSession(); });
  const preferences = { models: ['original'] }, request = f.auth.updatePort.request('preferences', preferences);
  await entered.promise; preferences.models[0] = 'changed'; gate.resolve(); await request;
  assert.deepEqual(f.requests.find(item => item.path === 'software-updates').body.preferences, { models: ['original'] });
});

test('业务发送前后都检查绝对期限和关闭状态，不重新授权', async t => {
  const f = await fixture(t), gate = deferred(), entered = deferred();
  f.setPrepare(async () => { entered.resolve(); await gate.promise; });
  const pending = f.auth.generationPort.list('product'); await entered.promise;
  await f.auth.host.close(); gate.resolve(); await assert.rejects(pending, code('authorization_expired'));
  await assert.rejects(f.auth.updatePort.request('status'), code('authorization_expired'));
  assert.equal(f.requests.filter(item => item.path === 'generation').length, 0); assert.equal(f.calls.authorize, 1);
  const expired = await fixture(t); expired.tick(8 * 60 * 60_000);
  await assert.rejects(expired.auth.networkProxyPort.status(), code('authorization_expired'));
  assert.equal(expired.calls.initialize, 0);
});

test('恢复等待跨越页面绝对期限时不发送业务', async t => {
  const f = await fixture(t); f.setPrepare(() => f.tick(8 * 60 * 60_000));
  await assert.rejects(f.auth.generationPort.list('product'), code('authorization_expired'));
  assert.equal(f.requests.filter(item => item.path === 'generation').length, 0);
});

test('生成提交回执未知不自动重发，原任务ID和请求保留', async t => {
  const f = await fixture(t); await f.client.readUsage(); f.tick(60_000);
  f.setTransport((next, path) => { if (path === 'generation') { next(); throw Error('合成回执丢失'); } return next(); });
  const task = { id: randomUUID(), productId: 'product', nodeId: 'node', binding: 'provider:' + 'd'.repeat(64), request: { method: 'POST', path: '/images', contentType: 'application/json', body: btoa('{}') } };
  await assert.rejects(f.auth.generationPort.submit(task), code('authorization_connection_failed'));
  const sent = f.requests.filter(item => item.path === 'generation');
  assert.equal(sent.length, 1); assert.deepEqual(sent[0].body.task, task); assert.equal(f.calls.reconnect, 1);
});

test('无效准备函数在一次性授权兑换之前拒绝', async () => {
  let calls = 0;
  await assert.rejects(authorizeLocalStorage({ code: 'a'.repeat(64), origin: 'http://localhost:3100', prepareSession: null, fetchImpl: () => { calls++; } }), code('invalid_session_prepare'));
  assert.equal(calls, 0);
});
