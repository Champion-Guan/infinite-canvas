import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 构建日常启动候选, 日常入口候选, 加载日常启动候选, 日常启动器路径 } from './预审SQLite日常启动.mjs';
import { 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

const preview = 构建日常启动候选('.运行/SQLite配置合并-CPXu7b/配置合并接入记录.json');
const { startIsolatedAuthorizedWorkbench: start } = await 加载日常启动候选(preview, 日常启动器路径);
const { startDailyWorkbench } = await 加载日常启动候选(preview, '扩展功能/本机服务/日常工作台.mjs');
const { dailyWorkbenchPaths, prepareDailyDataRoot } = await 加载日常启动候选(preview, '扩展功能/本机服务/日常数据根.mjs');
const storage = await 加载SQLite写入协调隔离服务(JSON.parse(readFileSync('.运行/SQLite写入协调-2XvqNB/写入协调接入记录.json')));
const load = path => import(pathToFileURL(join(preview.integration.副本, path)).href);
const { authorizeLocalStorage } = await load('web/src/guan/sqlite/本机授权客户端.mjs');
const { createRenewingDataClient } = await load('web/src/guan/sqlite/续期数据客户端.mjs');
const { createShardedApplicationStorage } = await load('web/src/guan/sqlite/分片应用存储.mjs');
const roots = [], materials = [];
const code = expected => error => error?.code === expected;
function temp() { const root = mkdtempSync(join(tmpdir(), 'guan-stage6-daily-preview-')); roots.push(root); return root; }
function fixture() {
  const root = temp(), webRoot = join(root, 'web'), dataRoot = join(root, '数据'); mkdirSync(webRoot);
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><head></head><body>日常入口协议预审，不是原画布UI</body></html>');
  writeFileSync(join(webRoot, 'entry.mjs'), 'export const preview=true;');
  const material = randomBytes(32); materials.push(material);
  return { webRoot, dataRoot, storage, initialize: true, credentialKeyProvider: { create: async () => Buffer.from(material), read: async () => Buffer.from(material) } };
}
function raw(origin, path = '/', headers = {}) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: url.port, path, method: 'GET', headers: { Host: url.host, ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    }); req.on('error', reject); req.end();
  });
}
async function connect(app) {
  const transport = (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: app.origin, 'Sec-Fetch-Site': 'same-origin' } });
  const auth = await authorizeLocalStorage({ origin: app.origin, code: app.issueTicket().code, fetchImpl: transport });
  const client = createRenewingDataClient({ ...auth, origin: app.origin, fetchImpl: transport });
  const application = createShardedApplicationStorage({ client, secretPort: auth.secretPort });
  return { auth, client, application, async close() { await application.flush(); application.close(); await client.close(); } };
}

test('候选只有3文件，不重复应用旧批次；锚点漂移与重复变换拒绝', () => {
  assert.equal(preview.delta.size, 3);
  assert.equal(preview.delta.get(日常启动器路径).原文, readFileSync(join(preview.integration.副本, 日常启动器路径), 'utf8'));
  assert.throws(() => 日常入口候选(preview.delta.get(日常启动器路径).产物));
  assert.throws(() => 日常入口候选('unexpected source'));
});
test('默认随机127入口保持，HTML握手仍要求顶层导航；无Cookie/重定向', async () => {
  const app = await start(fixture());
  try {
    assert.match(app.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await raw(app.origin)).status, 403);
    const page = await raw(app.origin, '/', { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' });
    assert.equal(page.status, 200); assert.match(page.text, /guan-local-bootstrap/);
    assert.equal(page.headers['set-cookie'], undefined); assert.equal(page.headers.location, undefined);
  } finally { await app.close(); }
});
test('localhost精确Origin贯穿入口材料、HTTP凭据与分片持久化；重开同库恢复（非浏览器UI）', async () => {
  const f = fixture(), app = await start({ ...f, endpoint: { hostname: 'localhost', port: 0 } });
  let connection;
  const config = JSON.stringify({ state: { config: { channels: [{ apiKey: 'synthetic-daily-not-real' }] } }, version: 0 });
  const media = Buffer.from('synthetic-daily-media');
  try {
    assert.match(app.origin, /^http:\/\/localhost:\d+$/);
    const page = await raw(app.origin, '/', { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' });
    assert.equal(page.status, 200); assert.equal(page.headers.location, undefined);
    connection = await connect(app);
    await connection.application.createInstance().setItem('infinite-canvas:ai_config_store', config);
    await connection.application.createInstance({ storeName: 'image_files' }).setItem('daily-media', new Blob([media], { type: 'image/png' }));
    await connection.close(); connection = null;
  } finally { await connection?.close(); await app.close(); }
  const reopened = await start({ ...f, initialize: false, endpoint: { hostname: 'localhost', port: 0 } });
  try {
    assert.equal(reopened.workspaceId, app.workspaceId); connection = await connect(reopened);
    assert.equal(await connection.application.createInstance().getItem('infinite-canvas:ai_config_store'), config);
    assert.deepEqual(Buffer.from(await (await connection.application.createInstance({ storeName: 'image_files' }).getItem('daily-media')).arrayBuffer()), media);
  } finally { await connection?.close(); await reopened.close(); }
});
test('localhost入口拒绝127别名Host、错端口、跨Origin和跨站；不放宽原保护', async () => {
  const app = await start({ ...fixture(), endpoint: { hostname: 'localhost', port: 0 } });
  try {
    for (const headers of [{ Host: '127.0.0.1:' + new URL(app.origin).port }, { Host: 'localhost:3100' },
      { Origin: 'http://127.0.0.1:' + new URL(app.origin).port }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await raw(app.origin, '/entry.mjs', headers)).status, 403);
    }
    assert.equal((await raw(app.origin, '/entry.mjs', { Origin: app.origin })).status, 200);
  } finally { await app.close(); }
});
test('不接受公网监听、任意端口、额外endpoint字段；失败不创建数据', async () => {
  const f = fixture();
  for (const endpoint of [null, [], {}, { hostname: '0.0.0.0', port: 0 }, { hostname: 'evil.invalid', port: 0 },
    { hostname: 'localhost', port: 3000 }, { hostname: '127.0.0.1', port: 3100 }, { hostname: 'localhost', port: 0, ignored: true }]) {
    await assert.rejects(start({ ...f, endpoint }), code('invalid_launcher_endpoint'));
  }
  assert.equal(existsSync(f.dataRoot), false);
});
test('endpoint等待期间变更不改变已复制的Host/Origin', async () => {
  const f = fixture(), endpoint = { hostname: 'localhost', port: 0 }, pending = start({ ...f, endpoint });
  endpoint.hostname = 'evil.invalid'; endpoint.port = 3000;
  const app = await pending;
  try { assert.match(app.origin, /^http:\/\/localhost:/); assert.equal((await raw(app.origin, '/entry.mjs')).status, 200); }
  finally { await app.close(); }
});
test('独立中文数据根仅明确初始化父容器，不创建数据库，权限0700', () => {
  const support = temp(), paths = dailyWorkbenchPaths(support);
  assert.throws(() => prepareDailyDataRoot({ applicationSupport: support }), code('daily_initialization_required'));
  assert.equal(existsSync(paths.container), false);
  assert.equal(prepareDailyDataRoot({ applicationSupport: support, initialize: true }), paths.dataRoot.replace(/^\/var\//, '/private/var/'));
  assert.equal(lstatSync(paths.container).mode & 0o777, 0o700); assert.equal(existsSync(paths.dataRoot), false);
});
test('已有非空工作区拒绝再次初始化，文件保持；正常重开交存储层继续核验', () => {
  const support = temp(), paths = dailyWorkbenchPaths(support);
  prepareDailyDataRoot({ applicationSupport: support, initialize: true }); mkdirSync(paths.dataRoot, { mode: 0o700 });
  writeFileSync(join(paths.dataRoot, '保留证据'), 'unchanged');
  assert.throws(() => prepareDailyDataRoot({ applicationSupport: support, initialize: true }), code('daily_initialization_denied'));
  assert.equal(readFileSync(join(paths.dataRoot, '保留证据'), 'utf8'), 'unchanged');
  assert.equal(prepareDailyDataRoot({ applicationSupport: support }).endsWith('/AI-Workbench-重建版/工作区'), true);
});
test('未知容器内容、链接、可被他人写的目录拒绝，不清理或修权限', () => {
  for (const kind of ['unknown', 'link', 'writable']) {
    const support = temp(), paths = dailyWorkbenchPaths(support); mkdirSync(paths.container, { mode: 0o700 });
    if (kind === 'unknown') writeFileSync(join(paths.container, '私人文件'), 'keep');
    if (kind === 'link') symlinkSync(temp(), paths.dataRoot);
    if (kind === 'writable') chmodSync(paths.container, 0o722);
    assert.throws(() => prepareDailyDataRoot({ applicationSupport: support, initialize: true }),
      error => ['unknown_daily_root', 'unsafe_daily_root'].includes(error.code));
    if (kind === 'unknown') assert.equal(readFileSync(join(paths.container, '私人文件'), 'utf8'), 'keep');
    if (kind === 'link') assert.equal(lstatSync(paths.dataRoot).isSymbolicLink(), true);
    if (kind === 'writable') assert.equal(lstatSync(paths.container).mode & 0o777, 0o722);
  }
});
test('悬空容器/工作区链接拒绝，不创建目标或替换链接', () => {
  for (const kind of ['container', 'workspace']) {
    const support = temp(), paths = dailyWorkbenchPaths(support), missing = join(support, '不存在');
    if (kind === 'workspace') mkdirSync(paths.container, { mode: 0o700 });
    const link = kind === 'container' ? paths.container : paths.dataRoot; symlinkSync(missing, link);
    assert.throws(() => prepareDailyDataRoot({ applicationSupport: support, initialize: true }), code('unsafe_daily_root'));
    assert.equal(lstatSync(link).isSymbolicLink(), true); assert.equal(existsSync(missing), false);
  }
});
test('日常入口必须当前保存关闭确认；仅构造路径不创建生产目录', async () => {
  await assert.rejects(startDailyWorkbench({}), code('maintenance_confirmation_required'));
  assert.match(dailyWorkbenchPaths().dataRoot, /Library\/Application Support\/AI-Workbench-重建版\/工作区$/);
});
test('3100现有服务占用时日常候选安全失败；不访问数据根/Keychain或停止原服务', async () => {
  // 只对当前已占用端口尝试独占监听；预检不成立即停止，不借空闲3100启动候选。
  const { execFileSync } = await import('node:child_process');
  const before = execFileSync('lsof', ['-nP', '-iTCP:3100', '-sTCP:LISTEN'], { encoding: 'utf8' });
  assert.match(before, /LISTEN/); let opens = 0, services = 0;
  const f = fixture();
  await assert.rejects(startDailyWorkbench({ webRoot: f.webRoot, initialize: true, savedAndClosed: true,
    helperPath: '/unavailable-do-not-execute-helper', helperSHA256: '0'.repeat(64),
    storage: { openWorkspace() { opens++; throw Error('must not open'); }, startDataService() { services++; throw Error('must not start'); } } }), code('EADDRINUSE'));
  assert.equal(opens, 0); assert.equal(services, 0);
  assert.equal(execFileSync('lsof', ['-nP', '-iTCP:3100', '-sTCP:LISTEN'], { encoding: 'utf8' }), before);
});
test.after(() => { for (const material of materials) material.fill(0); console.log(JSON.stringify({ syntheticRoots: roots, retained: true, realKeychainAccessed: false, real3100TakenOver: false, sourceRoot: 根目录 })); });
