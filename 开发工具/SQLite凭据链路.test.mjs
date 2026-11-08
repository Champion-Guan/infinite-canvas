import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createSessionController } from '../扩展功能/本机服务/受控会话.mjs';
import { openSQLiteCredentialVault } from '../扩展功能/本机凭据/SQLite凭据保管.mjs';
import { createCredentialClient } from '../扩展功能/本机凭据/凭据客户端.mjs';
import { createRenewingDataClient } from '../扩展功能/本机存储/续期数据客户端.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';
import { 加载凭据预审模块, 凭据网关候选, 凭据自动入口候选 } from './预审SQLite凭据接入.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

const { createLocalAuthorizationGateway } = await 加载凭据预审模块('扩展功能/本机服务/本机授权网关.mjs');
const { authorizeLocalStorage } = await 加载凭据预审模块('web/src/guan/sqlite/本机授权客户端.mjs');
const { startIsolatedAuthorizedWorkbench } = await 加载凭据预审模块('扩展功能/本机服务/受限工作台启动器.mjs');
const roots = [], code = expected => error => error?.code === expected;
const fakeMaster = material => ({ read: async () => Buffer.from(material), create: async () => Buffer.from(material) });
async function fixture({ pageLifetime = 28_800_000, sessionTTL = 600_000, wrap = value => value } = {}) {
  let time = Date.now(); const parent = mkdtempSync(join(tmpdir(), 'guan-credential-http-')); roots.push(parent);
  const workspace = openWorkspace({ dataRoot: join(parent, '数据'), initialize: true });
  const vault = await openSQLiteCredentialVault({ workspace, keyProvider: fakeMaster(randomBytes(32)), initialize: true });
  let gateway;
  const server = createServer((req, res) => gateway.handle(req, res));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const service = await startDataService({ workspace, allowedOrigins: [origin], sessionTTL, now: () => time });
  const controller = createSessionController({ origin, service, now: () => time });
  gateway = createLocalAuthorizationGateway({ origin, dataURL: service.url, controller, credentialPort: wrap(vault), now: () => time, pageLifetime });
  const transport = (url, options) => fetch(url, { ...options, headers: { ...options?.headers, Origin: origin, 'Sec-Fetch-Site': 'same-origin' } });
  const authorization = await authorizeLocalStorage({ origin, code: gateway.issueTicket().code, fetchImpl: transport, now: () => time });
  return { workspace, vault, gateway, controller, service, origin, authorization, transport,
    advance(milliseconds) { time += milliseconds; }, now: () => time,
    async close() { gateway.close(); controller.close(); await new Promise(done => server.close(done)); await service.close(); vault.close(); workspace.close(); } };
}

test('真实HTTP授权→凭据端口→分片配置→SQLite→冷客户端恢复，正文与凭据分离', async () => {
  const f = await fixture(); let app, client;
  try {
    client = createRenewingDataClient({ ...f.authorization, origin: f.origin, fetchImpl: f.transport, now: f.now });
    app = createRecoverableShardedApplicationStorage({ client, secretPort: f.authorization.secretPort });
    const key = 'infinite-canvas:ai_config_store', config = JSON.stringify({ state: { apiKey: 'synthetic-http-api', channels: [{ apiKey: 'synthetic-http-channel' }] }, version: 0 });
    await app.createInstance().setItem(key, config); await app.flush(); app.close();
    const reader = createRecoverableShardedApplicationStorage({ client, secretPort: f.authorization.secretPort });
    assert.equal(await reader.createInstance().getItem(key), config); await reader.flush(); reader.close();
    for (const row of f.workspace.listDocuments('extension')) assert.equal(JSON.stringify(f.workspace.readDocument('extension', row.id)).includes('synthetic-http-api'), false);
    await client.close();
    await assert.rejects(f.authorization.secretPort.store('synthetic-after-close'), code('authorization_expired'));
  } finally { await f.close(); }
});

test('最大2048字节含控制字符凭据走HTTP可用，超限在客户端拒绝', async () => {
  const f = await fixture();
  try {
    const value = '\u0000'.repeat(2048), ref = await f.authorization.secretPort.store(value);
    assert.equal(await f.authorization.secretPort.read(ref), value);
    await assert.rejects(f.authorization.secretPort.store('x'.repeat(2049)), code('invalid_credential'));
  } finally { await f.close(); }
});

for (const kind of ['origin', 'host', 'cross-site', 'protocol', 'capability', 'get', 'query', 'unknown-field', 'oversize']) test('HTTP凭据边界拒绝：' + kind, async () => {
  const f = await fixture();
  try {
    const exchange = await f.transport(f.origin + '/__guan-local/authorize', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Guan-Local-Protocol': 'guan-local-authorization.v1' }, body: JSON.stringify({ code: f.gateway.issueTicket().code }) }).then(response => response.json());
    const headers = { Origin: f.origin, Host: new URL(f.origin).host, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'X-Guan-Local-Protocol': 'guan-local-authorization.v1', Authorization: 'Bearer ' + exchange.capability };
    let path = '/__guan-local/credentials', method = 'POST', value = { operation: 'store', value: 'synthetic-should-not-save' };
    if (kind === 'origin') headers.Origin = 'http://localhost:65534';
    if (kind === 'host') headers.Host = 'malicious.test';
    if (kind === 'cross-site') headers['Sec-Fetch-Site'] = 'cross-site';
    if (kind === 'protocol') headers['X-Guan-Local-Protocol'] = 'other';
    if (kind === 'capability') headers.Authorization = 'Bearer ' + '0'.repeat(64);
    if (kind === 'get') method = 'GET';
    if (kind === 'query') path += '?copy=1';
    if (kind === 'unknown-field') value.extra = true;
    if (kind === 'oversize') value.value = 'x'.repeat(20_000);
    const result = await new Promise((resolve, reject) => {
      const req = httpRequest(f.origin + path, { method, headers }, res => { const chunks = []; res.on('data', value => chunks.push(value)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() })); });
      req.on('error', reject); req.end(JSON.stringify(value));
    });
    assert.ok(result.status >= 400); assert.equal(result.headers['access-control-allow-origin'], undefined);
    assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(result.text.includes('synthetic-should-not-save'), false);
    assert.equal(f.workspace.listDocuments('extension').filter(row => row.id.startsWith('secret:')).length, 0);
  } finally { await f.close(); }
});

test('页面关闭与数据租约休眠过期均撤销凭据读写，不静默重新授权', async () => {
  const f = await fixture({ sessionTTL: 1000 });
  try {
    await f.authorization.host.initialize(); const ref = await f.authorization.secretPort.store('synthetic-expiry');
    f.advance(1001); await assert.rejects(f.authorization.secretPort.read(ref), code('session_expired'));
    assert.equal(f.workspace.readDocument('extension', ref).revision, 1);
  } finally { await f.close(); }
  const g = await fixture();
  try {
    const ref = await g.authorization.secretPort.store('synthetic-close'); await g.authorization.host.close();
    await assert.rejects(g.authorization.secretPort.read(ref), code('authorization_expired'));
  } finally { await g.close(); }
});

test('长凭据操作完成前页面授权到期，不再返回明文结果', async () => {
  let release, entered;
  const started = new Promise(done => { entered = done; });
  const f = await fixture({ pageLifetime: 1000, wrap: vault => ({ ...vault, async read(ref) { entered(); await new Promise(done => { release = done; }); return vault.read(ref); } }) });
  try {
    const ref = await f.authorization.secretPort.store('synthetic-slow-read');
    const reading = f.authorization.secretPort.read(ref); await started; f.advance(1001); release();
    await assert.rejects(reading, code('authorization_denied'));
  } finally { await f.close(); }
});

test('网关消毒底层敏感错误，客户端拒绝假引用/错协议/丢ACK，不回退浏览器', async () => {
  const f = await fixture({ wrap: vault => ({ ...vault, async store() { throw Error('DO-NOT-LEAK-synthetic-key /private/synthetic-path'); } }) });
  try {
    await assert.rejects(f.authorization.secretPort.store('synthetic-fail'), error => error.code === 'credential_unavailable' && !error.message.includes('DO-NOT-LEAK'));
  } finally { await f.close(); }
  for (const command of [async () => ({ format: 'future', ref: 'secret:' + '0'.repeat(64) }), async () => ({ format: 'guan-credentials.v1', ref: 'secret:invalid' }), async () => { throw Error('synthetic-lost-ack'); }]) {
    const client = createCredentialClient({ command }); await assert.rejects(client.store('synthetic-value'));
  }
  const reader = createCredentialClient({ command: async () => ({ format: 'guan-credentials.v1', ref: 'secret:' + '1'.repeat(64), value: 'synthetic-wrong-ref' }) });
  await assert.rejects(reader.read('secret:' + '0'.repeat(64)), code('credential_ack_invalid'));
});

test('候选只接受精确原始文本，不让重复/缺失锚点偷改历史', () => {
  const gateway = readFileSync(new URL('../扩展功能/本机服务/本机授权网关.mjs', import.meta.url), 'utf8');
  assert.throws(() => 凭据网关候选(gateway + gateway)); assert.throws(() => 凭据网关候选('unknown'));
  assert.throws(() => 凭据自动入口候选('unknown'));
});

test('候选启动器装配已批准协调服务：首备份含凭据标记，HTTP鉴权可用，正常停止再打开', async () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-credential-launcher-')); roots.push(root);
  const web = join(root, 'web'), { mkdirSync } = await import('node:fs'); mkdirSync(web, { mode: 0o700 });
  writeFileSync(join(web, 'index.html'), '<!doctype html><html><head><title>仅HTTP启动器夹具</title></head><body>不是原画布验收</body></html>', { flag: 'wx', mode: 0o600 });
  const storage = await 加载SQLite写入协调隔离服务(建立SQLite写入协调隔离服务()), material = randomBytes(32), dataRoot = join(root, '数据');
  const launcher = await startIsolatedAuthorizedWorkbench({ webRoot: web, dataRoot, initialize: true, storage, credentialKeyProvider: fakeMaster(material) });
  try {
    // Node fetch会强制Sec-Fetch-Mode:cors，不能冒充文档导航；HTTP夹具显式构造请求头。
    const page = await new Promise((resolve, reject) => {
      const request = httpRequest(launcher.origin, { headers: { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Site': 'none' } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, html: Buffer.concat(chunks).toString('utf8') }));
      });
      request.on('error', reject); request.end();
    });
    assert.equal(page.status, 200); assert.ok(page.headers['content-security-policy'].includes("connect-src 'self' blob:"));
    const code = page.html.match(/name="guan-local-bootstrap" content="([0-9a-f]{64})"/)?.[1]; assert.ok(code);
    const auth = await authorizeLocalStorage({ code, origin: launcher.origin, fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: launcher.origin, 'Sec-Fetch-Site': 'same-origin' } }) });
    const ref = await auth.secretPort.store('synthetic-launched-secret'); assert.equal(await auth.secretPort.read(ref), 'synthetic-launched-secret');
    assert.equal(launcher.getStatus().backup.lastBackup.documentCount, 1); await auth.host.close();
  } finally { await launcher.close(); }
  const reopened = await startIsolatedAuthorizedWorkbench({ webRoot: web, dataRoot, storage, credentialKeyProvider: fakeMaster(material) });
  assert.equal(reopened.getStatus().ready, true); await reopened.close();
  await assert.rejects(startIsolatedAuthorizedWorkbench({ webRoot: web, dataRoot, storage, credentialKeyProvider: fakeMaster(randomBytes(32)) }), code('credential_master_mismatch'));
  const opened = storage.openWorkspace({ dataRoot }); opened.close(); // 失败清理没有遗留自己的实例锁。
});

test.after(() => console.log(JSON.stringify({ syntheticRoots: roots, realKeychainAccessed: false, actualCanvasLoaded: false, installedOn3100: false })));
