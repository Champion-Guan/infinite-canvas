import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { request } from 'node:http';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createDataClient } from '../扩展功能/本机存储/浏览器适配.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { MAX_DOCUMENT_BYTES } from '../扩展功能/本机存储/协议.mjs';

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
function oversizedRequest(f, path, length) {
  return new Promise((resolve, reject) => {
    const req = request(f.service.url + path, { method: 'PUT', headers: {
      Origin: origin, Authorization: `Bearer ${f.session.token}`, 'X-Guan-CSRF': f.session.csrf,
      'Content-Type': 'application/json', 'Content-Length': String(length),
    } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, json: async () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end();
  });
}

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
    const largeValue = { payload: 'x'.repeat(3 * 1024 * 1024) };
    const largeWrite = await f.call(`${f.base}/documents/extension/large-document`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: largeValue, expectedRevision: 0, operationId: randomUUID(), mediaIds: [] }) });
    assert.equal(largeWrite.status, 200, '超过旧2MiB边界的文档仍可保存');
    assert.equal(f.store.readDocument('extension', 'large-document').value.payload.length, largeValue.payload.length);
    await expectError(await oversizedRequest(f, path, MAX_DOCUMENT_BYTES + 1024 * 1024 + 1), 413, 'body_too_large');
    await expectError(await f.call(`${f.base}/media`, { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: '<script/>' }), 400, 'invalid_media');
    const media = await (await f.call(`${f.base}/media`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'only synthetic' })).json();
    const download = await f.call(`${f.base}/media/${media.id}`); assert.equal(await download.text(), 'only synthetic');
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff'); assert.match(download.headers.get('content-disposition'), /^attachment;/);
    const error = await f.call(`${f.base}/media/${'f'.repeat(64)}`); const text = await error.text();
    assert.equal(error.status, 404); assert.equal(text.includes(f.root), false);
    assert.equal(f.store.readDocument('canvas', 'demo'), null);
  } finally { await f.close(); }
});

test('超过32MiB的媒体通过单次HTTP请求写入单个SQLite BLOB并可冷读', async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.alloc(33 * 1024 * 1024, 0x7a);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    let mediaPosts = 0;
    const client = createDataClient({
      url: f.service.url, session: f.session,
      fetchImpl: (url, init) => {
        if (url.endsWith(`${f.base}/media`) && init.method === 'POST') mediaPosts++;
        return fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
      },
    });
    const saved = await client.writeMedia(blob);
    assert.equal(mediaPosts, 1);
    assert.equal(saved.size, bytes.length);
    assert.equal(saved.id, createHash('sha256').update(bytes).digest('hex'));
    const db = new DatabaseSync(join(f.root, '工作台.sqlite'), { readOnly: true });
    try {
      const row = db.prepare('SELECT typeof(content) AS kind,length(content) AS size FROM media WHERE id=?').get(saved.id);
      assert.equal(row.kind, 'blob');
      assert.equal(row.size, bytes.length);
    } finally { db.close(); }
    const cold = f.store.readMedia(saved.id);
    assert.equal(cold.bytes.length, bytes.length);
    assert.equal(createHash('sha256').update(cold.bytes).digest('hex'), saved.id);
    client.close();
  } finally { await f.close(); }
});

test('多张几MiB媒体使用一次本机请求和一个SQLite事务，逐张确认并可冷读', async () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-media-batch-'));
  let commits = 0, store, service, client;
  try {
    store = openWorkspace({ dataRoot: root, initialize: true, beforeCommit: () => commits++ });
    service = await startDataService({ workspace: store, allowedOrigins: [origin], port: 0, rateLimit: 0 });
    const session = service.issueSession(origin), base = `/v1/workspaces/${store.workspaceId}`;
    let batchPosts = 0;
    client = createDataClient({
      url: service.url, session,
      fetchImpl: (url, init) => {
        if (url.endsWith(`${base}/media/batch`) && init.method === 'POST') batchPosts++;
        return fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
      },
    });
    const blobs = [1, 2, 3].map((value, index) => new Blob([Buffer.alloc((index + 1) * 1024 * 1024, value)], { type: index === 1 ? 'image/jpeg' : 'image/png' }));
    const saved = await client.writeMediaBatch(blobs.map(blob => ({ blob })));
    assert.equal(batchPosts, 1);
    assert.equal(commits, 1);
    assert.equal(saved.length, blobs.length);
    for (let index = 0; index < blobs.length; index++) {
      assert.equal(saved[index].size, blobs[index].size);
      assert.equal(saved[index].id, createHash('sha256').update(Buffer.from(await blobs[index].arrayBuffer())).digest('hex'));
      assert.equal((await client.readMedia(saved[index].id)).size, blobs[index].size);
    }
    const bad = await fetch(service.url + `${base}/media/batch`, { method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${session.token}`, 'X-Guan-CSRF': session.csrf, 'Content-Type': 'application/x-guan-media-batch' },
      body: Buffer.from('invalid batch') });
    await expectError(bad, 400, 'invalid_media_batch');
    assert.equal(commits, 1, '格式错误的媒体批次不能打开SQLite写事务');
  } finally {
    client?.close();
    if (service) await service.close();
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('单文件媒体在写入队列繁忙时仍先接收完整请求体', async () => {
  const f = await fixture();
  let releaseWrite;
  const heldWrite = new Promise(resolve => { releaseWrite = resolve; });
  let enteredWrite;
  const entered = new Promise(resolve => { enteredWrite = resolve; });
  try {
    const active = f.service.runTrustedWrite(async () => {
      enteredWrite();
      await heldWrite;
    });
    await entered;

    const size = 32 * 1024 * 1024;
    let response, stalled = false, sent = 0;
    const received = new Promise((resolve, reject) => {
      const req = request(f.service.url + `${f.base}/media`, { method: 'POST', headers: {
        Origin: origin, Authorization: `Bearer ${f.session.token}`, 'X-Guan-CSRF': f.session.csrf,
        'Content-Type': 'application/octet-stream', 'Content-Length': String(size),
      } }, res => {
        response = res;
        res.resume();
        res.on('end', resolve);
        res.on('error', reject);
      });
      req.on('error', reject);
      const chunk = Buffer.alloc(64 * 1024, 0x5a);
      const write = () => {
        while (sent < size) {
          const end = Math.min(sent + chunk.length, size);
          const accepted = req.write(chunk.subarray(0, end - sent));
          sent = end;
          if (!accepted) {
            stalled = true;
            req.once('drain', () => { stalled = false; write(); });
            return;
          }
        }
        req.end();
      };
      write();
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    const sentBeforeRelease = sent === size && !stalled && !response;
    releaseWrite();
    await active;
    await received;
    assert.equal(sentBeforeRelease, true, `媒体请求体应在等待 SQLite 写队列时被完整接收（${sent}/${size}）`);
  } finally {
    releaseWrite();
    await f.close();
  }
});

test('真实编码器保存24张几MiB图片时按批减少HTTP请求和SQLite提交', async () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-image-workflow-'));
  let commits = 0, store, service, client, codec;
  try {
    store = openWorkspace({ dataRoot: root, initialize: true, beforeCommit: () => commits++ });
    service = await startDataService({ workspace: store, allowedOrigins: [origin], port: 0, rateLimit: 0 });
    const session = service.issueSession(origin), base = `/v1/workspaces/${store.workspaceId}`;
    let mediaPosts = 0;
    client = createDataClient({
      url: service.url, session,
      fetchImpl: (url, init) => {
        if (init.method === 'POST' && (url.endsWith(`${base}/media`) || url.endsWith(`${base}/media/batch`))) mediaPosts++;
        return fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
      },
    });
    codec = createValueCodec({ client });
    const sizes = [1_600_000, 2_100_000, 2_900_000];
    const images = Array.from({ length: 24 }, (_, index) => new Blob([Buffer.alloc(sizes[index % sizes.length], index + 1)], { type: 'image/png' }));
    const started = performance.now();
    const encoded = await codec.encode({ images });
    const uploadMs = performance.now() - started;
    assert.equal(encoded.mediaIds.length, images.length);
    assert.ok(mediaPosts < images.length, `上传请求 ${mediaPosts} 次应少于图片数 ${images.length}`);
    assert.equal(commits, mediaPosts, '每个批次请求对应一个SQLite提交');
    const saved = await client.writeDocument({
      collection: 'extension', id: 'many-small-images', value: { tree: encoded.tree }, expectedRevision: 0,
      operationId: randomUUID(), mediaIds: encoded.mediaIds,
    });
    assert.equal(saved.persisted, true);
    assert.equal(commits, mediaPosts + 1, '画布文档在图片ACK之后只提交一次');
    assert.equal(store.readDocument('extension', 'many-small-images').mediaIds.length, images.length);
    assert.equal(store.readUsage().databases[0].stores.find(item => item.name === 'media_blobs').records, images.length);
    console.log(`[图片工作流性能] ${images.length}张、${(images.reduce((sum, blob) => sum + blob.size, 0) / 1048576).toFixed(1)} MiB，上传${mediaPosts}次请求，耗时${uploadMs.toFixed(1)} ms`);
  } finally {
    codec?.close();
    client?.close();
    if (service) await service.close();
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
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
