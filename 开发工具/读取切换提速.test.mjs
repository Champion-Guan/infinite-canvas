import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { createDataClient } from '../扩展功能/本机存储/浏览器适配.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';
import { buildFragmentPlan } from '../扩展功能/本机存储/分片值编码.mjs';
import { readNamespaceSnapshot } from '../扩展功能/本机存储/命名空间快照.mjs';
import { createPacedDataClient } from '../扩展功能/本机存储/请求调度.mjs';
import { syntheticCanvas } from './分片合成数据.mjs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const rootId = name => 'app-' + createHash('sha256').update(name).digest('hex');

test('后台读取满额仍可立即保存及读验新分片；总96次窗口和跨实例共享不变', async () => {
  let time = 0, calls = 0; const sleepers = [];
  const client = { readDocument: async () => { calls++; }, readMedia: async () => { calls++; }, writeDocument: async () => { calls++; } };
  const options = { reserveWrites: true, now: () => time, wait: () => new Promise(resolve => sleepers.push(resolve)) };
  const paced = createPacedDataClient(client, options), same = createPacedDataClient(client, options);
  assert.equal(paced, same);
  await Promise.all(Array.from({ length: 64 }, () => paced.readMedia('合成图片')));
  let backgroundDone = false;
  const background = same.readMedia('后台缩略图').then(() => { backgroundDone = true; });
  await paced.readForWrite('extension', '合成新块');
  await Promise.all(Array.from({ length: 31 }, () => paced.writeDocument({})));
  assert.equal(calls, 96); assert.equal(backgroundDone, false);
  const finalWrite = paced.writeDocument({}); await Promise.resolve(); assert.equal(calls, 96);
  time = 10_050; sleepers.splice(0).forEach(resolve => resolve());
  await Promise.all([background, finalWrite]); assert.equal(calls, 98);
});

test('生产授权取消固定窗口但保留并发整形', async () => {
  let active = 0, peak = 0, calls = 0;
  const client = { readDocument: async () => {
    active++; peak = Math.max(peak, active); calls++;
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
  } };
  const paced = createPacedDataClient(client, { requestLimit: 0, maxConcurrent: 6 });
  await Promise.all(Array.from({ length: 128 }, () => paced.readDocument('extension', 'synthetic')));
  assert.equal(calls, 128); assert.ok(peak <= 6); assert.ok(peak > 1);
});
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'guan-read-speed-')), workspace = openWorkspace({ dataRoot: root, initialize: true });
  const origin = 'http://localhost:43201', service = await startDataService({ workspace, allowedOrigins: [origin], rateLimit: 120 });
  const session = service.issueSession(origin), requests = [];
  let alter = response => response;
  const client = createDataClient({ url: service.url, session, fetchImpl: async (url, input) => {
    requests.push({ path: new URL(url).pathname, method: input?.method ?? 'GET' });
    return alter(await fetch(url, { ...input, headers: { ...input?.headers, Origin: origin } }));
  } });
  t.after(async () => { await service.close(); client.close(); workspace.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, workspace, service, session, origin, client, requests, setAlter(value) { alter = value; } };
}
async function seed(workspace, namespace, entries) {
  const plan = await buildFragmentPlan(entries);
  for (const part of plan.fragments.values()) if (!workspace.readDocument('extension', part.id)) workspace.writeDocument({ collection: 'extension', id: part.id, value: part.value, expectedRevision: 0, operationId: randomUUID() });
  workspace.writeDocument({ collection: 'extension', id: rootId(namespace), value: { format: 'guan-app-storage.v2', namespace, head: plan.head, entryCount: entries.length }, expectedRevision: 0, operationId: randomUUID(), mediaIds: [...new Set(entries.flatMap(entry => entry[1].mediaIds))].sort() });
  return plan;
}

test('完整分片命名空间一次鉴权请求读取；客户端仍逐块验证，冷读取不写数据', async t => {
  const f = await fixture(t), key = 'infinite-canvas:canvas_store', value = syntheticCanvas({ products: 3, nodes: 200, textLength: 2000 });
  const codec = createValueCodec({ client: {} }), encoded = await codec.encode(JSON.parse(value));
  const plan = await seed(f.workspace, 'app_state', [[key, encoded]]); assert.ok(plan.fragments.size > 8);
  const app = createRecoverableShardedApplicationStorage({ client: f.client, namespaceSnapshots: true });
  assert.equal(await app.createInstance().getItem(key), value);
  assert.equal(f.requests.filter(r => r.path.includes('/namespace-snapshots/')).length, 1);
  assert.equal(f.requests.filter(r => r.path.includes('/documents/')).length, 0);
  assert.ok(f.requests.every(r => r.method === 'GET')); await app.flush(); app.close();
});

test('保存排空不等待其他命名空间的后台读取，同空间先读后写仍保持FIFO和ACK', async t => {
  const f = await fixture(t), bytes = Buffer.from('后台缩略图');
  const media = f.workspace.writeMedia(bytes, 'application/octet-stream');
  await seed(f.workspace, 'image_files', [['picture', { tree: ['blob', { mime: 'image/png', size: bytes.length, parts: [media.id] }], mediaIds: [media.id] }]]);
  let started, release;
  const reading = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.after(release);
  const client = { ...f.client, async readMedia(id) { started(); await gate; return f.client.readMedia(id); } };
  const app = createRecoverableShardedApplicationStorage({ client, namespaceSnapshots: true });
  const prompts = app.createInstance({ storeName: 'prompt_cache' }), images = app.createInstance({ storeName: 'image_files' });
  await prompts.setItem('draft', '第一稿');
  const imageRead = images.getItem('picture'); await reading;
  await prompts.setItem('draft', '第二稿');
  let timer;
  try { await Promise.race([app.flush(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('保存被后台读取拖住')), 500); })]); }
  finally { clearTimeout(timer); }
  assert.equal(app.getStatus().state, 'saved'); assert.equal(app.getStatus().pending, 0); assert.equal(app.getStatus().reads, 1);
  assert.throws(() => app.close(), error => error.code === 'save_not_confirmed');
  const imageWrite = images.setItem('caption', '真实写入');
  let flushed = false; const flush = app.flush().then(() => { flushed = true; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(flushed, false); assert.equal(app.getStatus().pending, 1);
  release(); await imageRead; await imageWrite; await flush;
  assert.equal(await images.getItem('caption'), '真实写入'); await app.flush(); app.close();
});

test('重复图片只校验读取一次，相同不可变描述复用URL，大小限额仍按引用计数', async () => {
  const blob = new Blob(['合成图片'], { type: 'application/octet-stream' }), id = createHash('sha256').update('合成图片').digest('hex');
  let reads = 0, urls = 0;
  const codec = createValueCodec({ client: { async readMedia() { reads++; return blob; } }, createObjectURL: () => 'blob:合成-' + ++urls, revokeObjectURL() {} });
  const descriptor = { mime: 'image/png', size: blob.size, parts: [id] };
  const restored = await codec.decode(['array', Array.from({ length: 126 }, () => ['blob-url', structuredClone(descriptor)])]);
  assert.equal(reads, 1); assert.equal(urls, 1); assert.equal(new Set(restored).size, 1);
  const next = await codec.encode(restored); assert.deepEqual(next.mediaIds, [id]); codec.close();
});

test('媒体读取失败不缓存成功结果；不同mime与描述仍独立校验', async () => {
  const blob = new Blob(['合成图']), id = createHash('sha256').update('合成图').digest('hex'); let reads = 0;
  const codec = createValueCodec({ client: { async readMedia() { if (++reads === 1) throw Error('合成断线'); return blob; } } });
  const tree = ['blob', { mime: 'image/png', size: blob.size, parts: [id] }];
  await assert.rejects(codec.decode(tree), /合成断线/); assert.equal((await codec.decode(tree)).type, 'image/png'); assert.equal(reads, 2);
  await assert.rejects(codec.decode(['blob', { ...tree[1], size: blob.size + 1 }]), error => error.code === 'media_corrupt');
  assert.equal(reads, 2); codec.close();
});

test('快照读取保留会话、Origin与工作区限制；未知命名空间和写入请求拒绝', async t => {
  const f = await fixture(t), base = f.service.url + '/v1/workspaces/' + f.workspace.workspaceId + '/namespace-snapshots/';
  const headers = { Origin: f.origin, Authorization: 'Bearer ' + f.session.token, 'X-Guan-CSRF': f.session.csrf };
  assert.equal((await fetch(base + 'app_state', { headers: { Origin: f.origin } })).status, 401);
  assert.equal((await fetch(base + 'unknown', { headers })).status, 400);
  assert.equal((await fetch(base + 'app_state', { method: 'POST', headers })).status, 405);
  const missing = await f.client.readNamespace('app_state'); assert.equal(missing.root, null); assert.deepEqual(missing.fragments, []);
  f.service.revokeSession(f.session.token);
  await assert.rejects(f.client.readNamespace('app_state'), error => error.code === 'session_denied');
});

test('损坏根、缺失分片和被篡改的响应不降级为空库或逐块读', async t => {
  const f = await fixture(t), encoded = await createValueCodec({ client: {} }).encode({ text: '完整数据' });
  await seed(f.workspace, 'app_state', [['one', encoded]]);
  f.setAlter(async response => {
    const snapshot = await response.json(); snapshot.fragments[0].value.data = '合成篡改'; return Response.json(snapshot);
  });
  const app = createRecoverableShardedApplicationStorage({ client: f.client, namespaceSnapshots: true });
  await assert.rejects(app.createInstance().getItem('one'), error => error.code === 'invalid_response');
  assert.equal(f.requests.length, 1); assert.ok(f.requests.every(r => r.method === 'GET'));
  await assert.rejects(readNamespaceSnapshot('app_state', async (_collection, id) => id === rootId('app_state') ? f.workspace.readDocument('extension', id) : null), error => error.code === 'fragment_corrupt');
});

test('恢复只改变修改时间或媒体临时地址不提交；真实编辑及未知字段仍完整保存', async t => {
  const f = await fixture(t), key = 'infinite-canvas:canvas_store';
  const app = createRecoverableShardedApplicationStorage({ client: f.client, namespaceSnapshots: true, readBlobUrl: async () => new Blob(['原始图片'], { type: 'image/png' }) });
  const store = app.createInstance(), firstDate = '2026-10-20T00:00:00.000Z', laterDate = '2026-10-24T00:00:00.000Z';
  const value = { state: { projects: [{ id: 'a', updatedAt: firstDate, nodes: [{ url: 'blob:原地址', text: '原内容' }] }, { id: 'b', updatedAt: firstDate, nodes: [] }] }, version: 1 };
  await store.setItem(key, JSON.stringify(value)); const revision = f.workspace.readDocument('extension', rootId('app_state')).revision;
  const restored = structuredClone(value); restored.state.projects[0].updatedAt = laterDate; restored.state.projects[0].nodes[0].url = 'blob:恢复地址';
  await store.setItem(key, JSON.stringify(restored));
  assert.equal(f.workspace.readDocument('extension', rootId('app_state')).revision, revision);
  restored.state.projects[1].updatedAt = laterDate; restored.state.projects[1].nodes.push({ text: '真实编辑', extensionField: '未知字段保留' });
  await store.setItem(key, JSON.stringify(restored));
  assert.equal(f.workspace.readDocument('extension', rootId('app_state')).revision, revision + 1);
  const saved = JSON.parse(await store.getItem(key));
  assert.equal(saved.state.projects[0].updatedAt, firstDate); assert.equal(saved.state.projects[1].updatedAt, laterDate);
  assert.equal(saved.state.projects[1].nodes[0].extensionField, '未知字段保留');
  await app.flush(); app.close();
});

test('所有命名空间的等值set、缺项remove及空clear不制造新版本，失败不被去重掩盖', async t => {
  const f = await fixture(t), app = createRecoverableShardedApplicationStorage({ client: f.client });
  const store = app.createInstance({ storeName: 'prompt_cache' });
  await store.setItem('one', { text: '第一稿' }); const before = f.workspace.readDocument('extension', rootId('prompt_cache')).revision;
  await store.setItem('one', { text: '第一稿' }); await store.removeItem('missing'); await app.flush();
  assert.equal(f.workspace.readDocument('extension', rootId('prompt_cache')).revision, before);
  await store.setItem('one', { text: '第二稿' }); assert.equal(f.workspace.readDocument('extension', rootId('prompt_cache')).revision, before + 1);
  await store.clear(); const cleared = f.workspace.readDocument('extension', rootId('prompt_cache')).revision;
  await store.clear(); assert.equal(f.workspace.readDocument('extension', rootId('prompt_cache')).revision, cleared); await app.flush(); app.close();
});

test('已发送但丢ACK的等值编辑仍保留恢复队列，原操作重试后才允许去重', async t => {
  const f = await fixture(t); let lose = true;
  const app = createRecoverableShardedApplicationStorage({ client: { ...f.client, async writeDocument(write) {
    const ack = await f.client.writeDocument(write);
    if (lose && write.id === rootId('prompt_cache')) { lose = false; throw Error('合成ACK丢失'); }
    return ack;
  } } });
  const store = app.createInstance({ storeName: 'prompt_cache' });
  await assert.rejects(store.setItem('same', '相同内容')); await assert.rejects(store.setItem('same', '相同内容'));
  assert.equal(app.getStatus().state, 'error'); await assert.rejects(app.flush());
  await app.retryPending(); await app.flush(); assert.equal(app.getStatus().state, 'saved');
  assert.equal(f.workspace.readDocument('extension', rootId('prompt_cache')).revision, 1); app.close();
});

const filename = '扩展功能/产品/画布保存判定.ts';
const { code } = await transformWithEsbuild(readFileSync(filename, 'utf8'), filename, { loader: 'ts', format: 'cjs', tsconfigRaw: '{}' });
const module = { exports: {} }; new Function('module', 'exports', code)(module, module.exports);
const { retainCanvasReferences, sameCanvasValue, canvasHasPendingChanges } = module.exports;

test('产品恢复和未编辑切换复用等值字段；真实文字、连线和视区变化保留', () => {
  const current = { nodes: [{ id: 'n', metadata: { text: '原文' } }], connections: [], viewport: { x: 1, y: 2, k: 1 } };
  const restored = retainCanvasReferences(current, structuredClone(current));
  assert.equal(restored.nodes, current.nodes); assert.equal(restored.connections, current.connections); assert.equal(restored.viewport, current.viewport);
  const patch = { nodes: [{ id: 'n', metadata: { text: '新文字' } }], connections: [{ id: 'edge' }], viewport: { x: 2, y: 2, k: 1 } };
  const changed = retainCanvasReferences(current, patch); assert.equal(changed.nodes, patch.nodes); assert.equal(changed.connections, patch.connections); assert.equal(changed.viewport, patch.viewport);
  assert.equal(sameCanvasValue([], new Array(1)), false); assert.equal(sameCanvasValue(new Blob(['a']), new Blob(['a'])), false);
  assert.equal(sameCanvasValue({ a: 1 }, { a: undefined }), false);
  assert.equal(canvasHasPendingChanges(current, structuredClone(current)), false);
  assert.equal(canvasHasPendingChanges(current, patch), true);
  assert.equal(canvasHasPendingChanges(undefined, current), true);
});
