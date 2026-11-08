import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 读取日常启动复验记录 } from './接入SQLite日常启动隔离副本.mjs';
import { 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

if (process.argv.length !== 3 || !process.argv[2].startsWith('--复验记录=')) throw Error('必须指定批准日常启动隔离记录');
const integration = 读取日常启动复验记录(process.argv[2].slice('--复验记录='.length));
const load = path => import(pathToFileURL(join(integration.副本, path)).href);
const { startIsolatedAuthorizedWorkbench: start } = await load('扩展功能/本机服务/受限工作台启动器.mjs');
const { dailyWorkbenchPaths, prepareDailyDataRoot } = await load('扩展功能/本机服务/日常数据根.mjs');
const { startDailyWorkbench } = await load('扩展功能/本机服务/日常工作台.mjs');
const { authorizeLocalStorage } = await load('web/src/guan/sqlite/本机授权客户端.mjs');
const { createRenewingDataClient } = await load('web/src/guan/sqlite/续期数据客户端.mjs');
const { createShardedApplicationStorage } = await load('web/src/guan/sqlite/分片应用存储.mjs');
const storage = await 加载SQLite写入协调隔离服务(JSON.parse(readFileSync(join(根目录, '.运行/SQLite写入协调-2XvqNB/写入协调接入记录.json'))));
const output = mkdtempSync(join(根目录, '.运行/output/SQLite日常启动磁盘协议-')), root = mkdtempSync(join(tmpdir(), 'guan-daily-disk-protocol-'));
const webRoot = join(root, 'web'), dataRoot = join(root, '数据'), material = randomBytes(32), results = [], blocked = [];
mkdirSync(webRoot); writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><head></head><body>磁盘协议验收，非原画布UI</body></html>');
writeFileSync(join(webRoot, 'entry.mjs'), 'export const isolated=true;');
const options = { webRoot, dataRoot, storage, initialize: true, credentialKeyProvider: { read: async () => Buffer.from(material), create: async () => Buffer.from(material) } };
function raw(origin, path = '/', headers = {}) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: url.port, path, headers: { Host: url.host, ...headers } }, res => {
      const chunks = []; res.on('data', value => chunks.push(value)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }); req.on('error', reject); req.end();
  });
}
function check(name, condition) { assert.ok(condition, name); results.push({ name, passed: true }); }
async function connect(app) {
  const transport = (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: app.origin, 'Sec-Fetch-Site': 'same-origin' } });
  const auth = await authorizeLocalStorage({ origin: app.origin, code: app.issueTicket().code, fetchImpl: transport });
  const client = createRenewingDataClient({ ...auth, origin: app.origin, fetchImpl: transport });
  const application = createShardedApplicationStorage({ client, secretPort: auth.secretPort });
  return { application, async close() { try { await application.flush(); } finally { application.close(); await client.close(); } } };
}
let app, connection, passed = false;
try {
  for (const endpoint of [{ hostname: 'localhost', port: 3000 }, { hostname: '0.0.0.0', port: 0 }, { hostname: '127.0.0.1', port: 3100 }, { hostname: 'localhost', port: 0, extra: true }]) {
    await assert.rejects(start({ ...options, endpoint }), error => error.code === 'invalid_launcher_endpoint');
  }
  check('磁盘启动器拒绝额外字段和未批准监听，失败不创建数据库', !existsSync(dataRoot));
  await assert.rejects(startDailyWorkbench({}), error => error.code === 'maintenance_confirmation_required');
  check('日常API缺少维护确认即拒绝，不构造正式存储或主密钥', true);
  const support = join(root, '临时父目录'); mkdirSync(support, { mode: 0o700 });
  const paths = dailyWorkbenchPaths(support);
  assert.throws(() => prepareDailyDataRoot({ applicationSupport: support }), error => error.code === 'daily_initialization_required');
  prepareDailyDataRoot({ applicationSupport: support, initialize: true });
  check('磁盘日常数据根模块只在显式初始化创建临时中文容器，不创建工作区', existsSync(paths.container) && !existsSync(paths.dataRoot));
  app = await start(options);
  check('默认随机127入口保持且不重定向', /^http:\/\/127\.0\.0\.1:\d+$/.test(app.origin) && (await raw(app.origin, '/entry.mjs')).headers.location === undefined);
  await app.close(); app = null;
  const endpoint = { hostname: 'localhost', port: 0 }, pending = start({ ...options, initialize: false, endpoint }); endpoint.hostname = 'evil.invalid'; endpoint.port = 3000;
  app = await pending;
  check('磁盘endpoint复制后不受调用方异步变更影响，实际使用随机localhost', /^http:\/\/localhost:\d+$/.test(app.origin) && new URL(app.origin).port !== '3100');
  assert.equal((await raw(app.origin)).status, 403);
  const page = await raw(app.origin, '/', { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' });
  check('顶层导航材料正常交付，不设置Cookie、不重定向', page.status === 200 && page.body.includes('guan-local-bootstrap') && !page.headers['set-cookie'] && !page.headers.location);
  for (const headers of [{ Host: '127.0.0.1:' + new URL(app.origin).port }, { Origin: 'http://localhost:3100' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await raw(app.origin, '/entry.mjs', headers)).status, 403);
  check('localhost严格Host、Origin和跨站边界保持', (await raw(app.origin, '/entry.mjs', { Origin: app.origin })).status === 200);
  connection = await connect(app);
  const config = JSON.stringify({ state: { config: { channels: [{ apiKey: 'synthetic-daily-disk-no-real-key' }] } }, version: 0 });
  const media = Buffer.from('synthetic-daily-disk-media');
  await connection.application.createInstance().setItem('infinite-canvas:ai_config_store', config);
  await connection.application.createInstance({ storeName: 'image_files' }).setItem('daily-disk-media', new Blob([media], { type: 'image/png' }));
  await connection.close(); connection = null; const id = app.workspaceId;
  await app.close(); app = null;
  app = await start({ ...options, initialize: false, endpoint: { hostname: 'localhost', port: 0 } }); connection = await connect(app);
  assert.equal(await connection.application.createInstance().getItem('infinite-canvas:ai_config_store'), config);
  assert.deepEqual(Buffer.from(await (await connection.application.createInstance({ storeName: 'image_files' }).getItem('daily-disk-media')).arrayBuffer()), media);
  check('同一合成SQLite冷重开跨随机端口恢复虚构凭据及媒体，工作区身份不变', app.workspaceId === id);
  passed = true;
} catch (error) { blocked.push(error.message); process.exitCode = 1; }
finally {
  try { await connection?.close(); await app?.close(); } catch (error) { passed = false; blocked.push(error.message); process.exitCode = 1; }
  material.fill(0);
  const report = { passed, results, blocked, output, syntheticDataRoot: dataRoot, source: integration.副本,
    diskApprovedModules: true, originalReactUI: false, real3100TakenOver: false, realKeychainAccessed: false, testMaterialZeroed: true };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); console.log(JSON.stringify(report, null, 2));
}
