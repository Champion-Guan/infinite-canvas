import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createDataClient } from '../扩展功能/本机存储/浏览器适配.mjs';

const origin = 'http://localhost:43101', otherOrigin = 'http://localhost:43102';
const roots = [];
async function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-http-')); roots.push(root);
  const store = openWorkspace({ dataRoot: root, initialize: true });
  const service = await startDataService({ workspace: store, allowedOrigins: [origin, otherOrigin], ...options });
  const session = service.issueSession(origin), base = `/v1/workspaces/${store.workspaceId}`;
  function call(path, init = {}) {
    return fetch(service.url + path, { ...init, headers: { Origin: origin, Authorization: `Bearer ${session.token}`, 'X-Guan-CSRF': session.csrf, ...init.headers } });
  }
  return { root, store, service, session, base, call, async close() { await service.close(); store.close(); } };
}
const value = (title = 'API合成画布') => ({ id: 'demo', title, nodes: [], connections: [] });
const body = (title, expectedRevision = 0, operationId = randomUUID()) => JSON.stringify({ value: value(title), expectedRevision, operationId, mediaIds: [] });
async function expectError(response, status, code) { assert.equal(response.status, status); assert.equal((await response.json()).error.code, code); }

test('Host、Origin、会话、CSRF、工作区、方法及路径逐层受限', async () => {
  const f = await fixture();
  try {
    const path = `${f.base}/documents/canvas/demo`;
    // fetch会重写Host，因此这里使用真实HTTP报文验证防DNS rebinding门禁。
    const badHost = await new Promise((resolve, reject) => {
      const req = request(f.service.url + path, { headers: { Host: 'evil.invalid', Origin: origin } }, res => {
        let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(text) }));
      }); req.on('error', reject); req.end();
    });
    await expectError(badHost, 403, 'host_denied');
    for (const bad of ['null', 'http://evil.invalid', 'http://localhost:43103']) await expectError(await f.call(path, { headers: { Origin: bad } }), 403, 'origin_denied');
    await expectError(await f.call(path, { headers: { Authorization: '' } }), 401, 'session_denied');
    await expectError(await f.call(path, { headers: { Origin: otherOrigin } }), 401, 'session_denied');
    await expectError(await f.call(path, { method: 'PUT', headers: { 'X-Guan-CSRF': '', 'Content-Type': 'application/json' }, body: body() }), 403, 'csrf_denied');
    await expectError(await f.call(`/v1/workspaces/${randomUUID()}/documents/canvas/demo`), 403, 'workspace_denied');
    await expectError(await f.call(path, { method: 'DELETE' }), 405, 'method_denied');
    await expectError(await f.call(`${f.base}/media/%2Fetc`), 400, 'invalid_path');
    await expectError(await f.call('/authorize'), 404, 'route_not_found');
    const preflight = await f.call(path, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type,x-guan-csrf' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    await expectError(await f.call(path, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'DELETE' } }), 403, 'preflight_denied');
    f.service.revokeSession(f.session.token); await expectError(await f.call(path), 401, 'session_denied');
  } finally { await f.close(); }
});

test('并发保存只有一个成功、响应丢失后同操作重试幂等、重启后仍可读', async () => {
  const f = await fixture(); let reopened;
  try {
    const path = `${f.base}/documents/canvas/demo`, request = body('第一条');
    const results = await Promise.all([f.call(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: request }), f.call(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body('第二条') })]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const ack = await results[0].json(); assert.equal(ack.persisted, true);
    assert.deepEqual(await (await f.call(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: request })).json(), ack);
    await f.close();
    reopened = openWorkspace({ dataRoot: f.root });
    assert.equal(reopened.workspaceId, f.store.workspaceId); assert.equal(reopened.readDocument('canvas', 'demo').revision, 1);
  } finally { if (reopened) reopened.close(); else await f.close(); }
});

test('体积、JSON、Content-Type和媒体安全；错误不泄露本机路径', async () => {
  const f = await fixture();
  try {
    const path = `${f.base}/documents/canvas/demo`;
    await expectError(await f.call(path, { method: 'PUT', body: body() }), 415, 'content_type_denied');
    await expectError(await f.call(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' }), 400, 'invalid_json');
    await expectError(await f.call(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(2 * 1024 * 1024 + 65537) }), 413, 'body_too_large');
    await expectError(await f.call(`${f.base}/media`, { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: '<script/>' }), 400, 'invalid_media');
    const media = await (await f.call(`${f.base}/media`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'only synthetic' })).json();
    const download = await f.call(`${f.base}/media/${media.id}`); assert.equal(await download.text(), 'only synthetic');
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff'); assert.match(download.headers.get('content-disposition'), /^attachment;/);
    const error = await f.call(`${f.base}/media/${'f'.repeat(64)}`); const text = await error.text();
    assert.equal(error.status, 404); assert.equal(text.includes(f.root), false);
    assert.equal(f.store.readDocument('canvas', 'demo'), null);
  } finally { await f.close(); }
});

test('会话过期与频率限制', async () => {
  let time = Date.now(); const f = await fixture({ now: () => time, sessionTTL: 100, rateLimit: 2 });
  try {
    assert.equal((await f.call('/health')).status, 200); assert.equal((await f.call('/health')).status, 200);
    await expectError(await f.call('/health'), 429, 'rate_limited'); time += 101;
    await expectError(await f.call('/health'), 401, 'session_denied');
  } finally { await f.close(); }
});

test('已授权会话连续读取不受固定频率窗口阻断', async () => {
  const f = await fixture({ rateLimit: 0 });
  try {
    for (let index = 0; index < 128; index++) assert.equal((await f.call('/health')).status, 200);
  } finally { await f.close(); }
});

test('两个真实工作区不串数据，相同Origin也不能跨服务复用令牌', async () => {
  const a = await fixture(), b = await fixture();
  try {
    const pathA = `${a.base}/documents/canvas/demo`, pathB = `${b.base}/documents/canvas/demo`;
    assert.equal((await a.call(pathA, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body('只属于A') })).status, 200);
    await expectError(await b.call(pathB), 404, 'document_not_found');
    await expectError(await b.call(pathB, { headers: { Authorization: `Bearer ${a.session.token}` } }), 401, 'session_denied');
    assert.notEqual(a.store.workspaceId, b.store.workspaceId); assert.equal(b.store.readDocument('canvas', 'demo'), null);
  } finally { await a.close(); await b.close(); }
});

test('浏览器契约：真实ACK才保存成功，冲突/假ACK/网络断开不静默降级', async () => {
  const f = await fixture();
  try {
    const states = [], transport = (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
    const client = createDataClient({ url: f.service.url, session: f.session, fetchImpl: transport, onStatus: status => states.push(status.state) });
    const input = { collection: 'canvas', id: 'demo', value: value(), expectedRevision: 0, operationId: randomUUID() };
    const ack = await client.writeDocument(input); assert.equal(ack.revision, 1); assert.deepEqual(states, ['saving', 'saved']);
    assert.equal((await client.readDocument('canvas', 'demo')).value.title, 'API合成画布');
    await assert.rejects(client.writeDocument({ ...input, operationId: randomUUID() }), error => error.code === 'revision_conflict');
    assert.equal(client.getStatus().state, 'error');
    await client.readDocument('canvas', 'demo'); assert.equal(client.getStatus().state, 'error', '读到旧数据不能抹去未保存错误');
    await client.writeDocument({ ...input, expectedRevision: 1, operationId: randomUUID() }); assert.equal(client.getStatus().state, 'saved');
    await assert.rejects(client.writeDocument({ ...input, value: { ...value(), apiKey: 'synthetic' } }), error => error.code === 'credential_field_rejected');
    assert.equal(client.getStatus().state, 'error', '本地校验失败也必须显示保存失败');
    const media = await client.writeMedia(new Blob(['client-media'], { type: 'application/octet-stream' }));
    assert.equal(await (await client.readMedia(media.id)).text(), 'client-media');
    const fake = createDataClient({ url: f.service.url, session: f.session, fetchImpl: async () => Response.json({ persisted: true, revision: 1 }) });
    await assert.rejects(fake.writeDocument(input), error => error.code === 'invalid_ack'); assert.equal(fake.getStatus().state, 'error');
    const offline = createDataClient({ url: f.service.url, session: f.session, fetchImpl: async () => { throw new Error('synthetic disconnect'); } });
    await assert.rejects(offline.writeDocument(input)); assert.equal(offline.getStatus().state, 'error');
    client.close(); await assert.rejects(client.readDocument('canvas', 'demo'), error => error.code === 'client_closed');
  } finally { await f.close(); }
});

test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
