import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync, linkSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { startIsolatedAuthorizedWorkbench } from '../扩展功能/本机服务/受限工作台启动器.mjs';
import { authorizeLocalStorage } from '../扩展功能/本机存储/本机授权客户端.mjs';
import { createRenewingDataClient } from '../扩展功能/本机存储/续期数据客户端.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';

const storage = { openWorkspace, startDataService };
const inline = 'document.documentElement.dataset.theme="system";';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-launcher-')), webRoot = join(root, '静态包'), dataRoot = join(root, '数据');
  mkdirSync(webRoot);
  writeFileSync(join(webRoot, 'index.html'), `<!doctype html><html><head><script>${inline}</script></head><body><main id="root"></main><script type="module" src="/入口.mjs"></script></body></html>`);
  writeFileSync(join(webRoot, '入口.mjs'), 'export const synthetic=true;');
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

test('启动前首份真实备份已完成；首屏脚本仅按哈希放行；中文模块和画布刷新可读', async () => {
  const f = fixture(), app = await start(f);
  try {
    assert.match(app.origin, /^http:\/\/127\.0\.0\.1:\d+$/); assert.notEqual(new URL(app.origin).port, '3100');
    const status = app.getStatus(); assert.equal(status.ready, true); assert.equal(status.backup.lastBackup.reason, 'startup');
    assert.equal(readdirSync(join(f.dataRoot, '备份')).length, 1);
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

test('首备份失败则启动失败并释放本次工作区锁，不留下可授权服务', async () => {
  const f = fixture(); let closed = false, dataURL;
  const failing = { ...storage, async startDataService(options) {
    const service = await storage.startDataService(options); dataURL = service.url;
    return { ...service, async createBackup() { throw Error('合成首备份故障'); }, async close() { await service.close(); closed = true; } };
  } };
  await assert.rejects(start(f, { storage: failing }), error => error.code === 'backup_failed');
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
