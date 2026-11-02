import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { startIsolatedAuthorizedWorkbench } from '../扩展功能/本机服务/受限工作台启动器.mjs';
import { authorizeLocalStorage } from '../扩展功能/本机存储/本机授权客户端.mjs';
import { createRenewingDataClient } from '../扩展功能/本机存储/续期数据客户端.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createUpdateReadinessProbe } from '../扩展功能/客户安装/更新就绪探针.mjs';

const storage = { openWorkspace, startDataService };
const roots = [];
const inline = 'document.documentElement.dataset.theme="system";';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-launcher-')), webRoot = join(root, '静态包'), dataRoot = join(root, '数据');
  roots.push(root);
  mkdirSync(webRoot);
  mkdirSync(join(webRoot, 'assets'));
  writeFileSync(join(webRoot, 'index.html'), `<!doctype html><html><head><script>${inline}</script></head><body><main id="root"></main><script type="module" src="/入口.mjs"></script></body></html>`);
  writeFileSync(join(webRoot, '入口.mjs'), 'export const synthetic=true;');
  writeFileSync(join(webRoot, 'assets/上传资产登记-fixture.js'), 'export function registerUploadedAsset() {}');
  const material = randomBytes(32);
  return { root, webRoot, dataRoot, credentialKeyProvider: { read: async () => Buffer.from(material), create: async () => Buffer.from(material) } };
}
function raw(origin, path, headers = {}, method = 'GET') {
  return new Promise((done, fail) => {
    const url = new URL(origin), req = request({ hostname: url.hostname, port: url.port, path, method, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }); req.on('error', fail); req.end();
  });
}
const start = (f, options = {}) => startIsolatedAuthorizedWorkbench({ ...f, initialize: true, storage, softwareUpdateOptions: { currentVersion: '2.0.0-beta.4' }, ...options });
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

test('自动备份关闭时升级停服不创建副本，保存排空后释放工作区锁', async () => {
  const f = fixture(); let calls = 0;
  const app = await start(f, { storage: { ...storage, async startDataService(options) {
    const service = await storage.startDataService(options);
    return { ...service, async createBackup() { calls++; throw Error('不应调用自动备份'); } };
  } } });
  try { await app.closeForUpdate(); } finally { await app.close(); }
  assert.equal(calls, 0); assert.equal(existsSync(join(f.dataRoot, '备份')), false);
  assert.equal(existsSync(join(f.dataRoot, '.实例锁.json')), false);
  const reopened = openWorkspace({ dataRoot: f.dataRoot }); reopened.close();
});

test('客户更新就绪探针随真实服务激活，不签发页面票据或阻碍后续停服', async () => {
  const f = fixture();
  let app;
  const probe = createUpdateReadinessProbe(() => ({ ready: app.getStatus().ready,
    version: '2.0.0-beta.21', managerVersion: '2.0.0-beta.21', workspaceId: app.workspaceId }));
  app = await start(f, { deferActivation: true,
    softwareUpdateOptions: { currentVersion: '2.0.0-beta.21', readinessProbe: probe } });
  try {
    assert.equal((await raw(app.origin, probe.path)).status, 503);
    app.activate();
    const response = await raw(app.origin, probe.path);
    assert.equal(response.status, 200);
    const value = JSON.parse(response.body);
    assert.equal(value.ready, true); assert.equal(value.workspaceId, app.workspaceId);
    assert.equal(value.managerVersion, '2.0.0-beta.21');
    const status = app.getStatus().authorization;
    assert.equal(status.authorizedPages, 0); assert.equal(status.pendingTickets, 0);
    assert.equal(status.activeRequests, 0);
    await app.closeForUpdate();
  } finally { await app.close(); }
});

test('启动默认不创建自动备份；首屏脚本仅按哈希放行；中文模块和画布刷新可读', async () => {
  const f = fixture(), app = await start(f);
  try {
    assert.match(app.origin, /^http:\/\/127\.0\.0\.1:\d+$/); assert.notEqual(new URL(app.origin).port, '3100');
    const status = app.getStatus(); assert.equal(status.ready, true); assert.equal(status.backup.lastBackup, null);
    assert.equal(status.backup.automatic, false); assert.equal(status.backup.nextAttemptAt, null);
    assert.equal(existsSync(join(f.dataRoot, '备份')), false);
    const navigate = { headers: { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' } };
    const home = await raw(app.origin, '/', navigate.headers), csp = home.headers['content-security-policy'];
    assert.equal(home.status, 200); assert.ok(csp.includes("'sha256-" + createHash('sha256').update(inline).digest('base64') + "'"));
    assert.equal(csp.split(';').find(value => value.includes('script-src')).includes('unsafe-inline'), false);
    assert.equal(home.headers['set-cookie'], undefined); assert.equal(home.headers['cache-control'], 'no-store');
    const module = await fetch(app.origin + '/' + encodeURIComponent('入口.mjs')); assert.equal(module.status, 200); assert.match(await module.text(), /synthetic/);
    const canvas = await raw(app.origin, '/canvas/test-1', navigate.headers); assert.equal(canvas.status, 200); assert.match(canvas.body, /guan-local-bootstrap/);
    const head = await fetch(app.origin + '/' + encodeURIComponent('入口.mjs'), { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  } finally { await app.close(); }
});

test('静态入口拒绝伪造Host、跨Origin/站点、路径穿越、查询、未知资源及非读取请求', async () => {
  const f = fixture(), app = await start(f);
  try {
    for (const headers of [{ Host: 'evil.invalid' }, { Origin: 'http://localhost:9' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await raw(app.origin, '/', headers)).status, 403);
    for (const path of ['/index.html?token=never', '/%2e%2e/index.html', '/%5cindex.html', '/unknown', '/canvas/a/b', '/入口.mjs?x']) assert.equal((await raw(app.origin, encodeURI(path).replaceAll('%25', '%'))).status, 404);
    assert.equal((await raw(app.origin, '/%zz')).status, 400);
    assert.equal((await raw(app.origin, '/', {}, 'POST')).status, 404);
  } finally { await app.close(); }
});

test('只兼容过期的上传登记分块；其他旧资源及缺少当前登记模块时继续404', async () => {
  const f = fixture(), app = await start(f);
  try {
    const legacy = await fetch(app.origin + '/assets/Wor850_f.js');
    assert.equal(legacy.status, 200);
    assert.match(await legacy.text(), /registerUploadedAsset/);
    assert.equal((await fetch(app.origin + '/assets/上传资产登记-old_hash.js')).status, 200);
    for (const path of [
      '/assets/another-module-old_hash.js',
      '/assets/上传资产登记-old_hash.css',
      '/assets/missing-upload-module.js',
    ]) assert.equal((await fetch(app.origin + path)).status, 404);
  } finally { await app.close(); }

  const missing = fixture();
  rmSync(join(missing.webRoot, 'assets/上传资产登记-fixture.js'));
  const appWithoutModule = await start(missing);
  try { assert.equal((await fetch(appWithoutModule.origin + '/assets/Wor850_f.js')).status, 404); }
  finally { await appWithoutModule.close(); }
});

test('授权→本机API→SQLite ACK→停止→独立冷重开，工作区不依赖浏览器Origin', async () => {
  const f = fixture(), app = await start(f); let client;
  try {
    const transport = (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: app.origin, 'Sec-Fetch-Site': 'same-origin' } });
    const authorization = await authorizeLocalStorage({ code: app.issueTicket().code, origin: app.origin, fetchImpl: transport });
    client = createRenewingDataClient({ ...authorization, origin: app.origin, fetchImpl: transport });
    const ack = await client.writeDocument({ collection: 'canvas', id: 'launcher', value: { id: 'launcher', title: '隔离启动保存', nodes: [], connections: [] }, expectedRevision: 0, operationId: randomUUID(), mediaIds: [] });
    assert.equal(ack.persisted, true); assert.equal(ack.revision, 1); await client.close();
  } finally { await app.close(); }
  assert.equal(existsSync(join(f.dataRoot, '.实例锁.json')), false);
  const reopened = storage.openWorkspace({ dataRoot: f.dataRoot });
  try { assert.equal(reopened.readDocument('canvas', 'launcher').value.title, '隔离启动保存'); } finally { reopened.close(); }
  await app.close(); assert.throws(() => app.issueTicket(), error => error.code === 'launcher_stopping');
});

test('自动备份关闭时启动不调用备份，即使备份能力失败也可正常启动和关闭', async () => {
  const f = fixture(); let closed = false, dataURL;
  const failing = { ...storage, async startDataService(options) {
    const service = await storage.startDataService(options); dataURL = service.url;
    return { ...service, async createBackup() { throw Error('合成首备份故障'); }, async close() { await service.close(); closed = true; } };
  } };
  const app = await start(f, { storage: failing });
  try { assert.equal(app.getStatus().backup.attempts, 0); assert.equal(app.getStatus().ready, true); }
  finally { await app.close(); }
  assert.equal(closed, true); assert.equal(existsSync(join(f.dataRoot, '.实例锁.json')), false);
  await assert.rejects(fetch(dataURL));
  const reopened = storage.openWorkspace({ dataRoot: f.dataRoot }); reopened.close();
});

test('未装配写入协调服务不能启动，关闭某资源报错仍执行其余清理', async () => {
  const a = fixture(); let missingClosed = false;
  await assert.rejects(start(a, { storage: { ...storage, async startDataService(options) {
    const service = await storage.startDataService(options);
    return { ...service, createBackup: undefined, async close() { await service.close(); missingClosed = true; } };
  } } }), error => error.code === 'write_coordination_required');
  assert.equal(missingClosed, true); assert.equal(existsSync(join(a.dataRoot, '.实例锁.json')), false);
  const b = fixture(), app = await start(b, { storage: { ...storage, async startDataService(options) {
    const service = await storage.startDataService(options);
    return { ...service, async close() { await service.close(); throw Error('合成关闭回执故障'); } };
  } } });
  await assert.rejects(app.close(), AggregateError);
  assert.equal(existsSync(join(b.dataRoot, '.实例锁.json')), false); assert.equal(app.getStatus().ready, false);
});

test('启动前拒绝目录中的链接、硬链接、未知文件和缺失入口，不创建数据库', async () => {
  for (const kind of ['symlink', 'hardlink', 'unknown', 'rootlink', 'missing']) {
    const f = fixture(); let webRoot = f.webRoot;
    if (kind === 'symlink') symlinkSync(join(f.webRoot, 'index.html'), join(f.webRoot, '链接.html'));
    if (kind === 'hardlink') linkSync(join(f.webRoot, 'index.html'), join(f.webRoot, '硬链接.html'));
    if (kind === 'unknown') writeFileSync(join(f.webRoot, '不允许.exe'), 'synthetic');
    if (kind === 'rootlink') { webRoot = join(f.root, '链接目录'); symlinkSync(f.webRoot, webRoot); }
    if (kind === 'missing') { webRoot = join(f.root, '空包'); mkdirSync(webRoot); }
    await assert.rejects(start(f, { webRoot }), error => ['invalid_web_bundle', 'invalid_web_root'].includes(error.code));
    assert.equal(existsSync(f.dataRoot), false);
  }
});

test('静态包启动时快照，后续磁盘变化不改变正在服务的脚本', async () => {
  const f = fixture(), before = readFileSync(join(f.webRoot, '入口.mjs'), 'utf8'), app = await start(f);
  try {
    writeFileSync(join(f.webRoot, '入口.mjs'), 'export const changed=true;');
    assert.equal(await (await fetch(app.origin + '/' + encodeURIComponent('入口.mjs'))).text(), before);
  } finally { await app.close(); }
});
