import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createSessionController } from '../扩展功能/本机服务/可重连受控会话.mjs';
import { createLocalAuthorizationGateway, AUTHORIZATION_PROTOCOL } from '../扩展功能/本机服务/可重连授权网关.mjs';
import { authorizeLocalStorage } from '../扩展功能/本机存储/可重连授权客户端.mjs';
import { createRenewingDataClient } from '../扩展功能/本机存储/可重连数据客户端.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';
import { 根目录 } from './公共.mjs';
import { openSQLiteCredentialVault } from '../扩展功能/本机凭据/SQLite凭据保管.mjs';
import { createLocalAuthorizationGateway as createCurrentAuthorizationGateway } from '../扩展功能/本机服务/本机授权网关.mjs';
import { authorizeLocalStorage as authorizeCurrentStorage } from '../扩展功能/本机存储/本机授权客户端.mjs';

const code = expected => error => error.code === expected;
const roots = [];
const write = (title = '合成文档', revision = 0, operationId = randomUUID()) => ({ collection: 'canvas', id: 'resume-demo',
  value: { id: 'resume-demo', title, nodes: [], connections: [] }, expectedRevision: revision, operationId });
async function fixture({ credentialPort, credentials = false, lifetime = 180_000, limit = 60 } = {}) {
  let time = Date.now(), gateway, controller, service, workspace, vault;
  const now = () => time, root = mkdtempSync(join(tmpdir(), 'guan-session-recovery-')); roots.push(root);
  const requests = [], server = createServer(async (req, res) => {
    if (gateway && await gateway.handle(req, res)) return;
    res.writeHead(404); res.end();
  });
  server.keepAliveTimeout = 100;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    workspace = openWorkspace({ dataRoot: join(root, '数据'), initialize: true });
    if (credentials) vault = await openSQLiteCredentialVault({ workspace, initialize: true, keyProvider: { create: async () => randomBytes(32), read: async () => { throw Error('合成新工作区不应读取已有密钥'); } } });
    service = await startDataService({ workspace, allowedOrigins: [origin], now, sessionTTL: 60_000 });
    controller = createSessionController({ service, origin, now, lifetime, renewalWindow: 10_000 });
    const createGateway = credentials ? createCurrentAuthorizationGateway : createLocalAuthorizationGateway;
    gateway = createGateway({ controller, origin, dataURL: service.url, credentialPort: credentialPort ?? vault, now, pageLifetime: lifetime, rateLimit: limit });
  } catch (error) {
    await new Promise(done => server.close(done)); controller?.close(); await service?.close(); vault?.close(); workspace?.close(); throw error;
  }
  const headers = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'X-Guan-Local-Protocol': AUTHORIZATION_PROTOCOL };
  const transport = async (url, init) => {
    requests.push({ url, method: init.method, body: init.body });
    return fetch(url, { ...init, headers: { ...init.headers, Origin: origin, 'Sec-Fetch-Site': 'same-origin' } });
  };
  const request = (body, capability, overrides = {}) => new Promise((done, fail) => {
    const req = httpRequest(origin + '/__guan-local/session', { method: 'POST', headers: { ...headers, Authorization: 'Bearer ' + capability, ...overrides } }, res => {
      const chunks = []; res.on('data', bytes => chunks.push(bytes));
      res.on('end', () => done(new Response(Buffer.concat(chunks), { status: res.statusCode })));
    });
    req.on('error', fail); req.end(JSON.stringify(body));
  });
  const authorize = options => (credentials ? authorizeCurrentStorage : authorizeLocalStorage)({ code: gateway.issueTicket().code, origin, now, fetchImpl: transport, ...options });
  const client = (auth, options) => createRenewingDataClient({ ...auth, origin, now, renewalWindow: 10_000, fetchImpl: transport, ...options });
  return { root, origin, workspace, service, controller, gateway, now, requests, transport, request, authorize, client,
    tick(ms) { time += ms; },
    async close() { gateway.close(); controller.close(); await new Promise(done => server.close(done)); await service.close(); vault?.close(); workspace.close(); } };
}

test('过期保存和普通重试均不重授权；用户重新连接后保留原操作落盘', async () => {
  const f = await fixture();
  try {
    const auth = await f.authorize(), client = f.client(auth);
    await client.readUsage(); f.tick(60_000);
    const input = write();
    await assert.rejects(client.writeDocument(input), code('session_expired'));
    await assert.rejects(client.writeDocument(input), code('session_expired'));
    assert.equal(f.requests.filter(item => item.body?.includes('reconnect')).length, 0);
    assert.equal(f.workspace.readDocument('canvas', input.id), null);
    await client.reconnect();
    assert.equal(client.getStatus().state, 'error', '连接成功不是保存成功');
    assert.equal(f.workspace.readDocument('canvas', input.id), null);
    const ack = await client.writeDocument(input);
    assert.equal(ack.operationId, input.operationId); assert.equal(ack.revision, 1);
    assert.equal(f.workspace.readDocument('canvas', input.id).value.title, input.value.title);
    await client.close();
  } finally { await f.close(); }
});

test('initialize和renew仍拒绝过期；reconnect保持工作区、Origin与绝对截止期', async () => {
  const f = await fixture({ lifetime: 90_000 });
  try {
    const auth = await f.authorize(), first = await auth.host.initialize();
    await assert.rejects(auth.host.reconnect(first), code('reconnect_not_due'));
    f.tick(60_000);
    await assert.rejects(auth.host.initialize(), code('session_expired'));
    await assert.rejects(auth.host.renew(first), code('session_expired'));
    for (const change of [{ workspaceId: randomUUID() }, { origin: 'http://localhost:5' }, { token: 'f'.repeat(64) }, { csrf: 'e'.repeat(64) }, { expiresAt: first.expiresAt + 1 }]) {
      await assert.rejects(auth.host.reconnect({ ...first, ...change }), code('session_mismatch'));
    }
    for (const invalid of [null, {}, false, [], { protocol: first.protocol }]) await assert.rejects(auth.host.reconnect(invalid), code('session_mismatch'));
    const next = await auth.host.reconnect(first);
    assert.notEqual(next.token, first.token); assert.notEqual(next.csrf, first.csrf);
    assert.equal(next.workspaceId, first.workspaceId); assert.equal(next.origin, first.origin);
    assert.equal(next.expiresAt, first.expiresAt + 30_000);
    f.tick(30_000);
    await assert.rejects(auth.host.reconnect(next), code('authorization_expired'));
  } finally { await f.close(); }
});

test('匿名、跨Origin/Host/Sec-Fetch和错误请求格式不能重新连接', async () => {
  const f = await fixture();
  try {
    const exchange = await f.transport(f.origin + '/__guan-local/authorize', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Guan-Local-Protocol': AUTHORIZATION_PROTOCOL }, body: JSON.stringify({ code: f.gateway.issueTicket().code }) });
    const { capability } = await exchange.json();
    const first = (await (await f.request({ operation: 'initialize' }, capability)).json()).session;
    f.tick(60_000);
    for (const change of [{ Origin: 'http://localhost:6' }, { Host: 'evil.invalid:6' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'X-Guan-Local-Protocol': 'wrong' }]) {
      assert.equal((await f.request({ operation: 'reconnect', session: first }, capability, change)).status, 403);
    }
    assert.equal((await f.request({ operation: 'reconnect', session: first }, '0'.repeat(64))).status, 401);
    for (const body of [{ operation: 'reconnect' }, { operation: 'reconnect', session: first, extra: true }, { operation: 'unknown', session: first }]) {
      assert.equal((await f.request(body, capability)).status, 400);
    }
    assert.equal((await f.request({ operation: 'reconnect', session: first }, capability)).status, 200);
  } finally { await f.close(); }
});

test('重新连接响应丢失不自动重发；明确重试复用同一服务器会话', async () => {
  const f = await fixture(); let lose = true, attempts = 0, issued = 0;
  try {
    const service = { issueSession(origin) { issued++; return f.service.issueSession(origin); }, revokeSession: token => f.service.revokeSession(token) };
    const controller = createSessionController({ service, origin: f.origin, now: f.now });
    try {
      const port = controller.open(), first = port.initialize(); f.tick(60_000);
      const a = port.reconnect(first), b = port.reconnect(first); assert.deepEqual(a, b); assert.equal(issued, 2);
    } finally { controller.close(); }
    const auth = await f.authorize({ fetchImpl: async (url, init) => {
      const response = await f.transport(url, init);
      if (init.body?.includes('"reconnect"')) { attempts++; if (lose) { lose = false; await response.arrayBuffer(); throw Error('合成响应丢失'); } }
      return response;
    } });
    const client = f.client(auth); await client.readUsage(); f.tick(60_000);
    const input = write('丢失恢复响应后仍只保存一次');
    await assert.rejects(client.writeDocument(input));
    await assert.rejects(client.reconnect(), code('authorization_connection_failed')); assert.equal(attempts, 1);
    await client.reconnect(); assert.equal(attempts, 2); await client.writeDocument(input);
    assert.equal(f.workspace.readDocument('canvas', input.id).revision, 1);
    await client.close();
  } finally { await f.close(); }
});

test('重复点击合并连接恢复；恢复期间新写入等待合法新会话', async () => {
  const f = await fixture(); let release, entered;
  const wait = new Promise(done => { release = done; }), started = new Promise(done => { entered = done; });
  try {
    const auth = await f.authorize(), client = f.client({ ...auth, host: { ...auth.host, async reconnect(previous) { entered(); await wait; return auth.host.reconnect(previous); } } });
    await client.readUsage(); f.tick(60_000);
    const a = client.reconnect(), b = client.reconnect(); assert.equal(a, b); await started;
    const saved = client.writeDocument(write('恢复途中编辑'));
    await assert.rejects(client.close(), code('save_not_confirmed'));
    release(); await a; await saved;
    assert.equal(f.workspace.readDocument('canvas', 'resume-demo').value.title, '恢复途中编辑');
    await client.close();
  } finally { release(); await f.close(); }
});

test('伪造工作区、Origin、期限或令牌返回时不替换连接、不发送保存', async () => {
  for (const change of [{ workspaceId: randomUUID() }, { origin: 'http://localhost:8' }, { token: 'broken' }, { csrf: 'broken' }, { expiresAt: 0 }, { protocol: 'wrong' }]) {
    const f = await fixture();
    try {
      const auth = await f.authorize(), client = f.client({ ...auth, host: { ...auth.host, async reconnect(previous) { return { ...await auth.host.reconnect(previous), ...change }; } } });
      await client.readUsage(); f.tick(60_000);
      const input = write(); await assert.rejects(client.writeDocument(input));
      await assert.rejects(client.reconnect(), code('invalid_session'));
      await assert.rejects(client.writeDocument(input), code('session_expired'));
      assert.equal(f.requests.filter(item => item.method === 'PUT').length, 0);
      assert.equal(f.workspace.readDocument('canvas', input.id), null);
    } finally { await f.close(); }
  }
});

test('完整分片队列恢复：原请求先重放，再顺序保存失败期间的新编辑', async () => {
  const f = await fixture(); let lose = true;
  try {
    const auth = await f.authorize(), client = f.client(auth, { fetchImpl: async (url, init) => {
      const response = await f.transport(url, init);
      if (init.method === 'PUT' && lose) { lose = false; await response.arrayBuffer(); throw Error('合成落盘ACK丢失'); }
      return response;
    } });
    const app = createRecoverableShardedApplicationStorage({ client }), store = app.createInstance();
    const original = { title: '原始快照', extra: { keep: true } };
    await assert.rejects(store.setItem('one', original)); original.title = '调用后改动不能污染第一笔';
    f.tick(60_000);
    await assert.rejects(store.setItem('two', '第二笔'));
    await assert.rejects(store.setItem('one', { title: '用户后续稿', extra: { keep: true } }));
    assert.equal(app.getStatus().pending, 3);
    await assert.rejects(app.retryPending());
    assert.equal(app.getStatus().failures[0].code, 'session_expired');
    const before = f.requests.filter(item => item.method === 'PUT').map(item => JSON.parse(item.body));
    await client.reconnect(); assert.equal(app.getStatus().pending, 3); assert.equal(app.getStatus().state, 'error');
    await app.retryPending(); await app.flush();
    const after = f.requests.filter(item => item.method === 'PUT').map(item => JSON.parse(item.body));
    assert.deepEqual(after[1], before[0], '分片第一次重放保留原operationId和完整载荷');
    assert.deepEqual(await store.getItem('one'), { title: '用户后续稿', extra: { keep: true } });
    assert.equal(await store.getItem('two'), '第二笔'); assert.equal(app.getStatus().state, 'saved');
    app.close(); await client.close();
  } finally { await f.close(); }
});

test('会话恢复不抹掉版本冲突，不能强行覆盖其他窗口的新版本', async () => {
  const f = await fixture();
  try {
    const auth = await f.authorize(), client = f.client(auth), input = write('本页旧稿');
    await client.readUsage(); f.workspace.writeDocument(write('其他窗口新稿'));
    f.tick(60_000); await assert.rejects(client.writeDocument(input), code('session_expired'));
    await client.reconnect(); await assert.rejects(client.writeDocument(input), code('revision_conflict'));
    assert.equal(f.workspace.readDocument('canvas', input.id).value.title, '其他窗口新稿');
    assert.equal(client.getStatus().state, 'error');
  } finally { await f.close(); }
});

test('签发容量失败保留原授权，恢复容量后同一请求可重试', async () => {
  const f = await fixture();
  try {
    const port = f.controller.open(), first = port.initialize(); f.tick(60_000);
    const tokens = Array.from({ length: 64 }, () => f.service.issueSession(f.origin));
    assert.throws(() => port.reconnect(first), code('too_many_sessions'));
    f.service.revokeSession(tokens[0].token);
    const next = port.reconnect(first); assert.equal(next.workspaceId, first.workspaceId);
    port.close();
  } finally { await f.close(); }
});

test('页面授权失效/服务重开不能自动再授权，原队列保持', async () => {
  const f = await fixture({ lifetime: 90_000 });
  try {
    const auth = await f.authorize(), client = f.client(auth), app = createRecoverableShardedApplicationStorage({ client }), store = app.createInstance();
    await store.getItem('x'); f.tick(60_000);
    await assert.rejects(store.setItem('x', '必须保留的未确认编辑'));
    f.tick(30_000); await assert.rejects(client.reconnect(), code('authorization_expired'));
    await assert.rejects(app.retryPending()); assert.equal(app.getStatus().pending, 1);
    assert.throws(() => app.close(), code('save_not_confirmed'));
    const g = await fixture();
    try {
      const other = await g.authorize(), c = g.client(other); await c.readUsage(); g.tick(60_000); g.gateway.close();
      await assert.rejects(c.reconnect(), code('authorization_closed'));
      assert.equal(g.workspace.listDocuments('extension').length, 0);
    } finally { await g.close(); }
  } finally { await f.close(); }
});

test('存储桥以同一运行时恢复，页内缓存/队列保留，重复点击及失败状态可观察', async () => {
  const f = await fixture(), previous = globalThis.window;
  try {
    const auth = await f.authorize(), client = f.client(auth), app = createRecoverableShardedApplicationStorage({ client });
    const view = new EventTarget(); let mounts = 0, reconnects = 0;
    view.__guanSQLiteHost = { async initialize() { mounts++; return app; }, async reconnect() { reconnects++; await client.reconnect(); } };
    globalThis.window = view;
    const require = createRequire(join(根目录, '.运行/3100源/画布副本/web/package.json')), ts = require('typescript');
    const source = readFileSync(join(根目录, '扩展功能/本机存储/上游浏览器存储桥.ts'), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const bridge = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64') + '#' + randomUUID());
    await bridge.initializeSQLiteApplication(); f.tick(60_000);
    const value = JSON.stringify({ state: { title: '页内稿' }, version: 0 });
    await assert.rejects(bridge.sqliteStateStorage.setItem('demo', value));
    assert.equal(bridge.storageStatus().reconnectRequired, true);
    const blocked = new Event('beforeunload', { cancelable: true }); view.dispatchEvent(blocked); assert.equal(blocked.defaultPrevented, true);
    const a = bridge.reconnectAndRetrySQLiteStorage(), b = bridge.reconnectAndRetrySQLiteStorage(); assert.equal(a, b); await a;
    assert.equal(mounts, 1); assert.equal(reconnects, 1); assert.equal(bridge.sqliteStateStorage.getItem('demo'), value);
    assert.equal(bridge.storageStatus().state, 'saved'); assert.equal(bridge.storageStatus().pending, 0);
    assert.equal(await app.createInstance().getItem('demo'), value);
    const allowed = new Event('beforeunload', { cancelable: true }); view.dispatchEvent(allowed); assert.equal(allowed.defaultPrevented, false);
    f.tick(120_000); await bridge.sqliteStateStorage.setItem('demo', value); // 同值无需连接或写入
    const changed = JSON.stringify({ state: { title: '期限之后的新编辑' }, version: 0 });
    await assert.rejects(bridge.sqliteStateStorage.setItem('demo', changed));
    await assert.rejects(bridge.reconnectAndRetrySQLiteStorage());
    assert.equal(bridge.storageStatus().reconnectError, 'authorization_expired');
    assert.equal(bridge.storageStatus().state, 'error'); assert.equal(bridge.sqliteStateStorage.getItem('demo'), changed);
  } finally { globalThis.window = previous; await f.close(); }
});

test('凭据端口沿用同一会话恢复；仅合成密钥加密落盘，不绕过过期校验', async () => {
  const f = await fixture({ credentials: true });
  try {
    const auth = await f.authorize(), client = f.client(auth); await client.readUsage();
    const value = 'synthetic-not-real-credential', ref = await auth.secretPort.store(value);
    assert.equal(auth.secretPort.read, undefined);
    f.tick(60_000); await assert.rejects(auth.secretPort.inspect(ref), code('session_expired'));
    await assert.rejects(auth.secretPort.store(value), code('session_expired'));
    await client.reconnect();
    assert.equal(await auth.secretPort.inspect(ref), 'guan-vault:' + ref); assert.equal(await auth.secretPort.store(value), ref);
    const doc = f.workspace.readDocument('extension', ref);
    assert.equal(doc.revision, 1); assert.equal(JSON.stringify(doc.value).includes(value), false);
    assert.equal(f.gateway.getStatus().authorizedPages, 1);
    await client.close();
  } finally { await f.close(); }
});

test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
