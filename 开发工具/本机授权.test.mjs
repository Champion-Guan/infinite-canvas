import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLocalAuthorizationGateway, AUTHORIZATION_PROTOCOL } from '../扩展功能/本机服务/本机授权网关.mjs';
import { createSessionController } from '../扩展功能/本机服务/受控会话.mjs';
import { authorizeLocalStorage } from '../扩展功能/本机存储/本机授权客户端.mjs';
import { createRenewingDataClient } from '../扩展功能/本机存储/续期数据客户端.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const errorCode = value => error => error.code === value;
async function fixture(options = {}) {
  let time = Date.now(), gateway, controller, service, workspace;
  const now = () => time, root = mkdtempSync(join(tmpdir(), 'guan-stage6-auth-')); roots.push(root);
  const server = createServer(async (req, res) => { if (gateway && await gateway.handle(req, res)) return; res.writeHead(404); res.end(); });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 100; server.maxConnections = 16;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    workspace = openWorkspace({ dataRoot: join(root, '数据'), initialize: true });
    service = await startDataService({ workspace, allowedOrigins: [origin], now, sessionTTL: 60_000 });
    controller = createSessionController({ service, origin, now, lifetime: 180_000, renewalWindow: 10_000 });
    gateway = createLocalAuthorizationGateway({ controller, origin, dataURL: service.url, now, pageLifetime: 180_000, ...options });
  } catch (error) { await new Promise(done => server.close(done)); controller?.close(); await service?.close(); workspace?.close(); throw error; }
  const headers = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'X-Guan-Local-Protocol': AUTHORIZATION_PROTOCOL };
  const request = (path, body, overrides = {}) => {
    const url = origin + '/__guan-local/' + path, init = { method: 'POST', body: JSON.stringify(body), ...overrides, headers: { ...headers, ...overrides.headers } };
    // Node fetch会自行归一化Host；Host伪造必须经原始HTTP检查，不能假装fetch发出了伪造头。
    if (overrides.headers?.Host) return new Promise((done, fail) => {
      const req = httpRequest(url, { method: init.method, headers: init.headers }, res => {
        const chunks = []; res.on('data', bytes => chunks.push(bytes));
        res.on('end', () => done(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
      }); req.on('error', fail); req.end(init.body);
    });
    return fetch(url, init);
  };
  const transport = (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: origin, 'Sec-Fetch-Site': 'same-origin' } });
  const authorize = (config = {}) => authorizeLocalStorage({ code: config.code ?? gateway.issueTicket().code, origin, now, fetchImpl: transport, ...config });
  return { root, origin, service, workspace, gateway, request, transport, authorize, now, tick(ms) { time += ms; },
    async close() { gateway.close(); controller.close(); await new Promise(done => server.close(done)); await service.close(); workspace.close(); } };
}

test('授权入口拒绝匿名、跨站/跨端口、Host伪造、无Origin及协议不匹配', async () => {
  const f = await fixture();
  try {
    const ticket = f.gateway.issueTicket();
    for (const headers of [{ Origin: '' }, { Origin: 'http://localhost:9' }, { Host: 'evil.invalid' }, { 'Sec-Fetch-Site': 'same-site' }, { 'X-Guan-Local-Protocol': '' }, { 'Content-Type': 'text/plain' }]) {
      const response = await f.request('authorize', { code: ticket.code }, { headers });
      assert.equal(response.status, 403); assert.equal(response.headers.get('access-control-allow-origin'), null); assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.equal((await f.request('session', { operation: 'initialize' })).status, 401);
    assert.equal(f.gateway.getStatus().authorizedPages, 0); assert.equal(f.gateway.getStatus().pendingTickets, 1);
  } finally { await f.close(); }
});

test('一次性码仅兑换一次；初始化幂等、无Cookie、能力不在状态输出', async () => {
  const f = await fixture();
  try {
    const ticket = f.gateway.issueTicket(), first = await f.request('authorize', { code: ticket.code });
    assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.equal(first.headers.get('set-cookie'), null);
    const { capability } = await first.json();
    assert.equal((await f.request('authorize', { code: ticket.code })).status, 403);
    const command = () => f.request('session', { operation: 'initialize' }, { headers: { Authorization: 'Bearer ' + capability } });
    const a = (await (await command()).json()).session, b = (await (await command()).json()).session;
    assert.ok(a.token === b.token && a.csrf === b.csrf);
    assert.equal(JSON.stringify(f.gateway.getStatus()).includes(capability), false);
    assert.equal(JSON.stringify(f.gateway.getStatus()).includes(ticket.code), false);
  } finally { await f.close(); }
});

test('未知路径、GET、预检、查询参数、额外字段和超大JSON均拒绝', async () => {
  const f = await fixture();
  try {
    const ticket = f.gateway.issueTicket();
    assert.equal((await f.request('authorize', undefined, { method: 'GET' })).status, 405);
    assert.equal((await f.request('authorize', undefined, { method: 'OPTIONS' })).status, 405);
    for (const path of ['authorize?code=hidden', '%61uthorize', 'unknown']) assert.equal((await f.request(path, { code: ticket.code })).status, 404);
    assert.equal((await f.request('authorize', { code: ticket.code, unexpected: true })).status, 403);
    assert.equal((await f.request('authorize', { code: 'x'.repeat(5000) })).status, 413);
    assert.equal((await fetch(f.origin + '/unrelated')).status, 404);
    assert.equal(f.gateway.getStatus().pendingTickets, 1);
  } finally { await f.close(); }
});

test('过期码不兑换；已授权页面到绝对期限不自动复活', async () => {
  const f = await fixture({ ticketTTL: 1000 });
  try {
    const ticket = f.gateway.issueTicket(); f.tick(1000);
    assert.equal((await f.request('authorize', { code: ticket.code })).status, 403);
    const auth = await f.authorize(), session = await auth.host.initialize();
    f.tick(180_001);
    await assert.rejects(auth.host.initialize(), errorCode('authorization_expired'));
    assert.equal((await f.transport(f.service.url + '/health', { headers: { Authorization: 'Bearer ' + session.token } })).status, 401);
    assert.equal(f.gateway.getStatus().authorizedPages, 0);
  } finally { await f.close(); }
});

test('授权码与能力绑定实例：不能在另一个服务端口兑换或复用', async () => {
  const a = await fixture(), b = await fixture();
  try {
    const ticket = a.gateway.issueTicket();
    assert.equal((await b.request('authorize', { code: ticket.code })).status, 403);
    const response = await a.request('authorize', { code: ticket.code }), value = await response.json();
    assert.equal((await b.request('session', { operation: 'initialize' }, { headers: { Authorization: 'Bearer ' + value.capability } })).status, 401);
  } finally { await a.close(); await b.close(); }
});

test('码与页面数量受限；关闭页面撤销数据令牌并释放名额', async () => {
  const f = await fixture({ maxTickets: 1, maxPages: 1 });
  try {
    const ticket = f.gateway.issueTicket(); assert.throws(() => f.gateway.issueTicket(), errorCode('too_many_tickets'));
    const auth = await f.authorize({ code: ticket.code }), session = await auth.host.initialize();
    const next = f.gateway.issueTicket();
    assert.equal((await f.request('authorize', { code: next.code })).status, 429);
    await auth.host.close();
    assert.equal((await f.transport(f.service.url + '/health', { headers: { Authorization: 'Bearer ' + session.token } })).status, 401);
    assert.equal((await f.request('authorize', { code: next.code })).status, 200);
  } finally { await f.close(); }
});

test('授权请求限流且重放失败不会签发页面', async () => {
  const f = await fixture({ rateLimit: 2 });
  try {
    for (let i = 0; i < 2; i++) assert.equal((await f.request('authorize', { code: '0'.repeat(64) })).status, 403);
    assert.equal((await f.request('authorize', { code: '0'.repeat(64) })).status, 429);
    assert.equal(f.gateway.getStatus().authorizedPages, 0); f.tick(60_000);
    assert.equal((await f.request('authorize', { code: '0'.repeat(64) })).status, 403);
  } finally { await f.close(); }
});

test('兑换限流不会阻断已授权页面关闭，刷新可继续取得授权', async () => {
  const f = await fixture({ rateLimit: 1 });
  try {
    const auth = await f.authorize();
    await auth.host.initialize();
    const denied = await f.request('authorize', { code: '0'.repeat(64) });
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get('retry-after'), '1');
    await auth.host.close();
    assert.equal(f.gateway.getStatus().authorizedPages, 0);
    f.tick(60_000);
    const next = await f.authorize();
    await next.host.close();
  } finally { await f.close(); }
});

test('真实授权→续期客户端→SQLite ACK，续期不另取授权码', async () => {
  const f = await fixture();
  try {
    const auth = await f.authorize(), client = createRenewingDataClient({ url: auth.url, host: auth.host, origin: f.origin, now: f.now, renewalWindow: 10_000, fetchImpl: f.transport });
    const write = { collection: 'canvas', id: 'auth-demo', value: { id: 'auth-demo', title: '真实授权测试', nodes: [], connections: [] }, expectedRevision: 0, operationId: randomUUID() };
    const ack = await client.writeDocument(write); assert.equal(ack.persisted, true);
    f.tick(51_000);
    assert.equal((await client.readDocument('canvas', 'auth-demo')).revision, 1);
    assert.equal(f.gateway.getStatus().authorizedPages, 1); assert.equal(f.gateway.getStatus().pendingTickets, 0);
    await client.close(); assert.equal(f.gateway.getStatus().authorizedPages, 0);
    assert.equal(f.workspace.readDocument('canvas', 'auth-demo').value.title, '真实授权测试');
  } finally { await f.close(); }
});

test('授权响应丢失不自动重发、不会创建第二页面', async () => {
  const f = await fixture(); let calls = 0;
  try {
    const ticket = f.gateway.issueTicket();
    await assert.rejects(f.authorize({ code: ticket.code, fetchImpl: async (...args) => { calls++; await f.transport(...args); throw Error('synthetic response lost'); } }), errorCode('authorization_connection_failed'));
    assert.equal(calls, 1); assert.equal(f.gateway.getStatus().authorizedPages, 1);
    assert.equal((await f.request('authorize', { code: ticket.code })).status, 403);
  } finally { await f.close(); }
});

test('客户端拒绝错误地址、时钟及伪造响应，始终omit凭据且不将码写URL', async () => {
  const f = await fixture();
  try {
    for (const origin of ['http://evil.invalid:8', f.origin + '/', 'https://localhost:8']) await assert.rejects(f.authorize({ origin }), errorCode('invalid_authorization_client'));
    const ticket = f.gateway.issueTicket();
    await assert.rejects(authorizeLocalStorage({ code: ticket.code, origin: f.origin, fetchImpl: async (url, init) => {
      assert.equal(url, f.origin + '/__guan-local/authorize'); assert.equal(url.includes(ticket.code), false);
      assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
      return Response.json({ protocol: AUTHORIZATION_PROTOCOL, origin: f.origin, capability: '0'.repeat(64), dataURL: 'http://evil.invalid:8', expiresAt: Date.now() + 1000 });
    } }), errorCode('invalid_authorization_response'));
    await assert.rejects(f.authorize({ code: ticket.code, now: () => NaN }), errorCode('invalid_authorization_response'));
  } finally { await f.close(); }
});

test('网关关闭撤销所有页面并停止签发', async () => {
  const f = await fixture();
  try {
    const auth = await f.authorize(), session = await auth.host.initialize();
    f.gateway.close(); assert.throws(() => f.gateway.issueTicket(), errorCode('authorization_closed'));
    assert.equal((await f.transport(f.service.url + '/health', { headers: { Authorization: 'Bearer ' + session.token } })).status, 401);
    assert.equal((await f.request('session', { operation: 'initialize' })).status, 503);
    assert.deepEqual(f.gateway.getStatus(), { closed: true, pendingTickets: 0, authorizedPages: 0, activeRequests: 0 });
  } finally { await f.close(); }
});
