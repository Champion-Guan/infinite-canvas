import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { 根目录 } from './公共.mjs';
import { 构建免填码候选, 免填码启动器候选, 加载免填码预审启动器 } from './预审SQLite免填码启动.mjs';
import { 媒体启动器路径 } from '../上游适配/SQLite临时媒体策略批准.mjs';
import { 核验授权入口自有依赖 } from '../上游适配/SQLite工作台授权入口批准.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';
import { authorizeLocalStorage } from '../扩展功能/本机存储/本机授权客户端.mjs';
import { createRenewingDataClient } from '../扩展功能/本机存储/续期数据客户端.mjs';

const navigation = { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Site': 'none' };
const roots = [];
async function fixture(html = '<!doctype html><html><head></head><body>免填码隔离预审</body></html>') {
  const root = mkdtempSync(join(tmpdir(), 'guan-auto-entry-')); roots.push(root);
  const webRoot = join(root, '静态包'); mkdirSync(webRoot); writeFileSync(join(webRoot, 'index.html'), html); writeFileSync(join(webRoot, '资源.mjs'), 'export const synthetic=true;');
  const storage = await 加载SQLite写入协调隔离服务(建立SQLite写入协调隔离服务());
  const { startIsolatedAuthorizedWorkbench } = await 加载免填码预审启动器();
  return { ...await startIsolatedAuthorizedWorkbench({ webRoot, dataRoot: join(root, '数据'), initialize: true, storage }), root };
}
function raw(origin, headers, method = 'GET') {
  // Node fetch会将Sec-Fetch-Mode重写为cors；用原始HTTP检验导航门禁，不能据此改服务器放行。
  return new Promise((done, fail) => {
    const url = new URL(origin), req = request({ hostname: url.hostname, port: url.port, path: '/', headers, method }, res => {
      const chunks = []; res.on('data', bytes => chunks.push(bytes)); res.on('end', () => done({ response: { status: res.statusCode, headers: new Headers(res.headers) }, html: Buffer.concat(chunks).toString() }));
    }); req.on('error', fail); req.end();
  });
}
function document(app, headers = {}) {
  return raw(app.origin, { ...navigation, ...headers });
}
const token = html => html.match(/<meta name="guan-local-bootstrap" content="([0-9a-f]{64})">/)?.[1];
const transport = app => (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: app.origin, 'Sec-Fetch-Site': 'same-origin' } });

test('候选仅3份自有文件，不改原作者HTML/main，旧批准来源与严格锚点保持', () => {
  const delta = 构建免填码候选(); assert.equal(delta.size, 3); assert.equal(delta.has('web/index.html'), false); assert.equal(delta.has('web/src/main.tsx'), false);
  const entry = delta.get('web/src/guan/sqlite/工作台自动入口.mjs').产物;
  assert.doesNotMatch(entry, /createElement\(['"](?:input|form)['"]\)|localStorage|sessionStorage|indexedDB/);
  assert.throws(() => 免填码启动器候选(delta.get(媒体启动器路径).产物), /锚点/);
  核验授权入口自有依赖(根目录);
  assert.equal(readFileSync(join(根目录, 媒体启动器路径), 'utf8').includes("connect-src 'self' blob:"), false);
});
test('仅顶层导航得到内部材料；跨站、iframe、fetch、HEAD不能领取；无Cookie及动态脚本', async () => {
  const app = await fixture();
  try {
    for (const headers of [{}, { ...navigation, 'Sec-Fetch-Site': 'cross-site' }, { ...navigation, 'Sec-Fetch-Dest': 'iframe' }, { ...navigation, 'Sec-Fetch-Mode': 'cors' }, { ...navigation, Host: 'evil.invalid' }]) {
      const { response, html } = await raw(app.origin, headers); assert.equal(response.status, 403); assert.equal(token(html), undefined);
    }
    assert.equal((await raw(app.origin, navigation, 'HEAD')).response.status, 403);
    assert.equal(app.getStatus().authorization.pendingTickets, 0);
    const { response, html } = await document(app); assert.equal(response.status, 200); assert.ok(token(html));
    assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-security-policy').includes("connect-src 'self' blob:"), true); assert.doesNotMatch(html, /<script/);
    const resource = await fetch(app.origin + '/' + encodeURIComponent('资源.mjs')); assert.equal(resource.status, 200); assert.equal(token(await resource.text()), undefined);
  } finally { await app.close(); }
});
test('启动材料自动兑换既有受控会话，真实SQLite保存/读取；重用、跨源与错误CSRF继续拒绝', async () => {
  const app = await fixture(); let client;
  try {
    const first = token((await document(app)).html), second = token((await document(app)).html); assert.ok(first && second && first !== second);
    const fetchImpl = transport(app);
    await assert.rejects(authorizeLocalStorage({ code: first, origin: app.origin, fetchImpl: (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: 'http://evil.invalid' } }) }), error => error.code === 'authorization_origin_denied');
    const authorization = await authorizeLocalStorage({ code: first, origin: app.origin, fetchImpl });
    client = createRenewingDataClient({ ...authorization, origin: app.origin, fetchImpl });
    const usage = await client.readUsage(); assert.ok(usage);
    const ack = await client.writeDocument({ collection: 'canvas', id: 'auto-entry', expectedRevision: 0, operationId: crypto.randomUUID(), mediaIds: [], value: { id: 'auto-entry', title: '无需手填码保存', nodes: [], connections: [] } });
    assert.equal(ack.persisted, true); assert.equal((await client.readDocument('canvas', 'auto-entry')).value.title, '无需手填码保存');
    await assert.rejects(authorizeLocalStorage({ code: first, origin: app.origin, fetchImpl }), error => error.code === 'authorization_denied');
    const session = await authorization.host.initialize();
    const denied = await fetch(authorization.url + `/v1/workspaces/${session.workspaceId}/documents/canvas/auto-entry`, { method: 'PUT', headers: { Origin: app.origin, Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json', 'X-Guan-CSRF': '0'.repeat(64) }, body: '{}' });
    assert.equal(denied.status, 403); assert.equal((await denied.json()).error.code, 'csrf_denied');
    await client.close(); client = null; assert.equal(app.getStatus().authorization.authorizedPages, 0);
  } finally { await app.close(); }
});
test('HTML缺少唯一head或已有启动材料时安全失败，不签发票据', async () => {
  for (const html of ['<!doctype html><body>无head</body>', '<head></head><head></head>', '<head><meta name="guan-local-bootstrap"></head>']) {
    const app = await fixture(html);
    try { const { response, html: body } = await document(app); assert.equal(response.status, 503); assert.equal(token(body), undefined); assert.equal(app.getStatus().authorization.pendingTickets, 0); }
    finally { await app.close(); }
  }
});
test.after(() => console.log(JSON.stringify({ syntheticAutomaticEntryRoots: roots, candidateOnly: true, real3100Untouched: true })));
