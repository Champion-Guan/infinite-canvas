import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 读取配置合并复验记录, 核验配置合并完整源码 } from './接入SQLite配置合并隔离副本.mjs';
import { 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';
import { 写入协调差异SHA256 } from '../上游适配/SQLite写入协调批准.mjs';

// 仅测试完整批准的隔离装配。不是生产启动器，也不把合成静态包称为原画布UI验收。
const args = process.argv.slice(2);
assert.ok(args.length === 2 || (args.length === 3 && args[2] === '--仅补测锁与关闭边界'));
assert.ok(args[0].startsWith('--配置合并记录=') && args[1].startsWith('--写入协调记录='));
const remainingOnly = args.length === 3;
const output = mkdtempSync(join(根目录, '.运行/output/SQLite完整装配生命周期-'));
const results = [], fixtures = [];
let integration, serviceIntegration, storage, startLauncher, authorize, createClient, createApp, passed = false, blocked, residualLockVerified = false, stepIndex = 0;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const errorCode = expected => error => error?.code === expected;
function tree(root) {
  const files = {};
  function walk(path = '') {
    for (const name of readdirSync(join(root, path))) {
      const relative = path ? path + '/' + name : name, file = join(root, relative), stat = lstatSync(file);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) walk(relative); else files[relative] = sha(readFileSync(file));
    }
  }
  walk(); return files;
}
function unchangedWithEmptySQLiteSidecars(before, root) {
  // Node SQLite只读打开WAL库也会创建共享索引及空WAL；这不等于业务提交。
  // 只允许新增这两个确知的辅助文件，主库、标记、备份及任何已有文件仍逐字一致。
  const after = tree(root), additions = Object.keys(after).filter(path => !(path in before));
  for (const path of additions) {
    assert.ok(['工作台.sqlite-wal', '工作台.sqlite-shm'].includes(path));
    const stat = lstatSync(join(root, path));
    assert.equal(stat.nlink, 1); assert.equal(stat.uid, process.getuid()); assert.equal(stat.mode & 0o077, 0);
    assert.equal(stat.size, path.endsWith('-wal') ? 0 : 32768); delete after[path];
  }
  if (additions.length) assert.equal(lstatSync(join(root, '工作台.sqlite-wal')).size, 0);
  assert.deepEqual(after, before);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-lifecycle-')), webRoot = join(root, '静态包'), dataRoot = join(root, '数据');
  mkdirSync(webRoot); writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><head></head><body>生命周期测试，不是工作台UI</body></html>', { flag: 'wx' });
  const material = randomBytes(32), calls = { read: 0, create: 0 };
  const f = { root, webRoot, dataRoot, material, calls, services: [], launchers: [] };
  f.provider = { async read() { calls.read++; return Buffer.from(material); }, async create() { calls.create++; return Buffer.from(material); } };
  fixtures.push(f); return f;
}
async function start(f, { initialize = false, provider = f.provider, serviceWrapper = value => value } = {}) {
  const runtime = { ...storage, openWorkspace(options) { f.workspace = storage.openWorkspace(options); return f.workspace; },
    async startDataService(options) { const service = await storage.startDataService(options); f.services.push(service); return serviceWrapper(service); } };
  const launcher = await startLauncher({ webRoot: f.webRoot, dataRoot: f.dataRoot, initialize, storage: runtime, credentialKeyProvider: provider });
  f.launchers.push(launcher); return launcher;
}
async function connect(app) {
  const transport = (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: app.origin, 'Sec-Fetch-Site': 'same-origin' } });
  const authorization = await authorize({ origin: app.origin, code: app.issueTicket().code, fetchImpl: transport });
  const client = createClient({ ...authorization, origin: app.origin, fetchImpl: transport });
  const application = createApp({ client, secretPort: authorization.secretPort });
  return { application, transport, async close() { await application.flush(); application.close(); await client.close(); } };
}
async function seed(f) { const app = await start(f, { initialize: true }); await app.close(); return tree(f.dataRoot); }
async function closedServices(f) { for (const service of f.services) await assert.rejects(fetch(service.url)); }
async function step(name, fn) {
  if (remainingOnly && stepIndex++ < 5) { results.push({ name, skipped: true, reason: '只补测锁与关闭边界，既有结果不在本次重跑' }); return; }
  try { await fn(); results.push({ name, passed: true }); console.log(JSON.stringify({ name, passed: true })); }
  catch (error) { results.push({ name, passed: false }); blocked = { name, reason: error.message }; throw error; }
}
try {
  integration = 读取配置合并复验记录(args[0].slice('--配置合并记录='.length));
  const record = resolve(args[1].slice('--写入协调记录='.length)), home = dirname(record), root = join(home, '服务包');
  assert.ok(home.startsWith(join(根目录, '.运行/SQLite写入协调-')) && /^SQLite写入协调-[A-Za-z0-9]+$/.test(home.split('/').at(-1)));
  assert.equal(record, join(home, '写入协调接入记录.json')); assert.equal(realpathSync(record), record);
  assert.equal(lstatSync(record).nlink, 1); assert.equal(realpathSync(root), root);
  serviceIntegration = JSON.parse(readFileSync(record));
  assert.equal(serviceIntegration.服务包, root); assert.equal(serviceIntegration.已接管3100, false);
  assert.equal(serviceIntegration.写入协调差异SHA256, 写入协调差异SHA256);
  storage = await 加载SQLite写入协调隔离服务(serviceIntegration);
  const load = path => import(pathToFileURL(join(integration.副本, path)).href);
  ({ startIsolatedAuthorizedWorkbench: startLauncher } = await load('扩展功能/本机服务/受限工作台启动器.mjs'));
  ({ authorizeLocalStorage: authorize } = await load('web/src/guan/sqlite/本机授权客户端.mjs'));
  ({ createRenewingDataClient: createClient } = await load('web/src/guan/sqlite/续期数据客户端.mjs'));
  ({ createShardedApplicationStorage: createApp } = await load('web/src/guan/sqlite/分片应用存储.mjs'));

  await step('最终磁盘装配：HTTP保存密文和媒体→排空关闭→同库新入口恢复，旧授权不复用', async () => {
    const f = fixture(), config = JSON.stringify({ state: { config: { channels: [{ apiKey: 'synthetic-lifecycle-not-real' }] } }, version: 0 });
    const bytes = Buffer.from('synthetic-lifecycle-media'), app = await start(f, { initialize: true });
    let connection, reopened, reader;
    try {
      assert.equal(app.getStatus().backup.lastBackup.documentCount, 1);
      connection = await connect(app);
      await connection.application.createInstance().setItem('infinite-canvas:ai_config_store', config);
      await connection.application.createInstance({ storeName: 'image_files' }).setItem('test-image', new Blob([bytes], { type: 'image/png' }));
      const workspaceId = app.workspaceId, oldCode = app.issueTicket().code;
      await connection.close(); connection = null; await app.close(); await app.close();
      assert.equal(existsSync(join(f.dataRoot, '.实例锁.json')), false); await closedServices(f);
      assert.throws(() => app.issueTicket(), errorCode('launcher_stopping'));
      reopened = await start(f); assert.equal(reopened.workspaceId, workspaceId);
      assert.equal(f.calls.create, 1); assert.equal(f.calls.read, 1);
      reader = await connect(reopened);
      await assert.rejects(authorize({ origin: reopened.origin, code: oldCode, fetchImpl: reader.transport }), errorCode('authorization_denied'));
      assert.equal(await reader.application.createInstance().getItem('infinite-canvas:ai_config_store'), config);
      const blob = await reader.application.createInstance({ storeName: 'image_files' }).getItem('test-image');
      assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
      assert.equal(f.workspace.listDocuments('extension').filter(row => row.id.startsWith('secret:')).length, 1);
      assert.equal(JSON.stringify(f.workspace.listDocuments('extension').map(row => f.workspace.readDocument('extension', row.id))).includes('synthetic-lifecycle-not-real'), false);
    } finally { await reader?.close(); await reopened?.close(); await connection?.close(); await app.close(); }
  });
  await step('同库重复启动拒绝，不清除原锁、不调用第二份主密钥端口，原服务可继续工作', async () => {
    const f = fixture(), app = await start(f, { initialize: true });
    try {
      const lock = readFileSync(join(f.dataRoot, '.实例锁.json')), calls = { ...f.calls };
      await assert.rejects(start(f), errorCode('workspace_locked'));
      assert.deepEqual(readFileSync(join(f.dataRoot, '.实例锁.json')), lock); assert.deepEqual(f.calls, calls);
      assert.equal(app.getStatus().ready, true);
      const connection = await connect(app); try { assert.equal(await connection.application.createInstance().getItem('absent'), null); } finally { await connection.close(); }
    } finally { await app.close(); }
  });
  for (const kind of ['missing', 'wrong']) await step('已有库主密钥' + kind + '时停止，不生成替代密钥或改写数据库', async () => {
    const f = fixture(), before = await seed(f); let creates = 0;
    const provider = { async read() { if (kind === 'missing') throw Error('synthetic key unavailable'); const wrong = Buffer.from(f.material); wrong[0] ^= 1; return wrong; }, async create() { creates++; throw Error('must not create'); } };
    await assert.rejects(start(f, { provider }), errorCode(kind === 'missing' ? 'credential_unavailable' : 'credential_master_mismatch'));
    assert.equal(creates, 0); assert.deepEqual(tree(f.dataRoot), before); await closedServices(f);
  });
  await step('未知schema在可写连接和凭据读取前拒绝，主库及已有文件保持，只允许SQLite空辅助文件', async () => {
    const f = fixture(); await seed(f);
    const db = new DatabaseSync(join(f.dataRoot, '工作台.sqlite')); try { db.exec('PRAGMA user_version=999'); } finally { db.close(); }
    const before = tree(f.dataRoot), calls = { ...f.calls };
    await assert.rejects(start(f), errorCode('schema_unsupported'));
    unchangedWithEmptySQLiteSidecars(before, f.dataRoot); assert.deepEqual(f.calls, calls);
  });
  await step('残留锁原样保留，拒绝启动，不猜测进程死亡后自动清锁', async () => {
    const f = fixture(); await seed(f);
    writeFileSync(join(f.dataRoot, '.实例锁.json'), JSON.stringify({ pid: 2147483647, nonce: randomUUID() }), { flag: 'wx', mode: 0o600 });
    const before = tree(f.dataRoot), calls = { ...f.calls };
    await assert.rejects(start(f), errorCode('workspace_locked'));
    unchangedWithEmptySQLiteSidecars(before, f.dataRoot); assert.deepEqual(f.calls, calls);
    residualLockVerified = true;
  });
  await step('首备份失败不交付可用入口，关闭本次服务并保留凭据库及数据', async () => {
    const f = fixture(); let closed = false;
    await assert.rejects(start(f, { initialize: true, serviceWrapper: service => ({ ...service, async createBackup() { throw Error('synthetic startup backup failure'); }, async close() { await service.close(); closed = true; } }) }), errorCode('backup_failed'));
    assert.equal(closed, true); assert.equal(existsSync(join(f.dataRoot, '.实例锁.json')), false); await closedServices(f);
    const workspace = storage.openWorkspace({ dataRoot: f.dataRoot });
    try { assert.ok(workspace.readDocument('extension', 'guan-credential-vault')); assert.equal(workspace.listDocuments('canvas').length, 0); } finally { workspace.close(); }
  });
  await step('关闭回执失败仍清理其余资源，报告AggregateError而非假成功', async () => {
    const f = fixture(), app = await start(f, { initialize: true, serviceWrapper: service => ({ ...service, async close() { await service.close(); throw Error('synthetic close acknowledgement failure'); } }) });
    f.expectedCloseFailure = true;
    await assert.rejects(app.close(), AggregateError); await assert.rejects(app.close(), AggregateError);
    assert.equal(app.getStatus().ready, false); assert.equal(existsSync(join(f.dataRoot, '.实例锁.json')), false);
    await assert.rejects(fetch(app.origin)); await closedServices(f);
  });
  核验配置合并完整源码(integration.副本, true); passed = true;
} catch (error) { blocked ??= { name: '批准装配前置核验', reason: error.message }; process.exitCode = 1; }
finally {
  for (const f of fixtures) {
    for (const app of f.launchers) try { await app.close(); } catch (error) { if (!f.expectedCloseFailure) { passed = false; blocked ??= { name: '本轮临时资源正常停止', reason: error.message }; process.exitCode = 1; } }
    f.material.fill(0);
  }
  const report = { passed, scope: remainingOnly ? '仅锁与关闭边界3项，不代表本次重跑完整8项' : '完整生命周期8项', results, blocked, output, integration, serviceIntegration, syntheticRoots: fixtures.map(f => f.root),
    browserUIVerified: false, realCredentialsUsed: false, keychainAccessed: false, production3100TakenOver: false, remainingLocksPreserved: residualLockVerified, automaticLockCleanupAttempted: false };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
