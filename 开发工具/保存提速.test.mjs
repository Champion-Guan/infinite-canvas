import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { buildFragmentPlan, readFragmentGraph } from '../扩展功能/本机存储/分片值编码.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';
import { syntheticCanvas } from './分片合成数据.mjs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

function fixture() {
  const media = new Map(), calls = { writes: 0, reads: 0, urls: 0 }, revoked = [];
  let fail = false;
  const codec = createValueCodec({
    client: {
      async writeMedia(blob) {
        calls.writes++; if (fail) throw Error('合成写入失败');
        const id = createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
        media.set(id, blob); return { id };
      },
      async readMedia(id) { calls.reads++; return media.get(id); },
    },
    async readBlobUrl() { calls.urls++; return new Blob(['合成图片'], { type: 'image/png' }); },
    createObjectURL: () => 'blob:已恢复图片', revokeObjectURL: url => revoked.push(url),
  });
  return { codec, calls, revoked, setFail(value) { fail = value; } };
}

test('编辑其他字段时已确认图片URL不重读或重传，媒体引用完整保留', async () => {
  const f = fixture(), original = { url: 'blob:合成原图', title: '第一稿' };
  const first = await f.codec.encode(original);
  const next = await f.codec.encode({ ...original, title: '第二稿' });
  assert.deepEqual(f.calls, { writes: 1, reads: 0, urls: 1 });
  assert.deepEqual(next.mediaIds, first.mediaIds);
  assert.equal((await f.codec.decode(next.tree)).title, '第二稿');
  f.codec.close();
});

test('同一storageKey换了临时预览地址时直接复用已确认媒体，不重复读取URL', async () => {
  let reads = 0;
  const blob = new Blob(['稳定媒体'], { type: 'image/png' });
  const id = createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
  const codec = createValueCodec({
    client: { readMedia: async () => blob, writeMedia: async () => ({ id }) },
    readBlobUrl: async () => { reads++; return blob; },
  });
  await codec.encode({ storageKey: 'image:稳定', bytes: blob.size, mimeType: blob.type, content: 'blob:第一地址' });
  await codec.encode({ storageKey: 'image:稳定', bytes: blob.size, mimeType: blob.type, content: 'blob:第二地址' });
  assert.equal(reads, 1);
  codec.close();
});

test('冷读取恢复的URL直接复用已经读验的媒体，缓存不泄露可变描述', async () => {
  const f = fixture(), encoded = await f.codec.encode({ url: 'blob:原图' });
  const restored = await f.codec.decode(encoded.tree), before = { ...f.calls };
  encoded.tree[1][0][1][1].parts[0] = '0'.repeat(64);
  const next = await f.codec.encode(restored);
  assert.deepEqual(f.calls, before);
  assert.notEqual(next.mediaIds[0], '0'.repeat(64));
  next.tree[1][0][1][1].parts[0] = '0'.repeat(64);
  assert.notEqual((await f.codec.encode(restored)).mediaIds[0], '0'.repeat(64));
  f.codec.close(); assert.deepEqual(f.revoked, ['blob:已恢复图片']);
});

test('媒体失败没有缓存成功标志，重试必须重新取得ACK', async () => {
  const f = fixture(); f.setFail(true);
  await assert.rejects(f.codec.encode('blob:原图'), /合成写入失败/);
  f.setFail(false); await f.codec.encode('blob:原图');
  assert.equal(f.calls.writes, 2); assert.equal(f.calls.urls, 2);
});

test('不可变Blob复用，可变ArrayBuffer修改后重新写入', async () => {
  const f = fixture(), blob = new Blob(['图像']), bytes = new Uint8Array([1, 2]);
  await f.codec.encode([blob, blob]); assert.equal(f.calls.writes, 1);
  const a = await f.codec.encode(bytes.buffer); bytes[0] = 3;
  const b = await f.codec.encode(bytes.buffer);
  assert.notDeepEqual(a.mediaIds, b.mediaIds); assert.equal(f.calls.writes, 3);
});

test('新临时地址、克隆Blob及原图交付图的相同内容只上传一遍', async () => {
  const f = fixture();
  const first = await f.codec.encode('blob:原图');
  const next = await f.codec.encode(['blob:恢复的新地址', structuredClone(new Blob(['合成图片'], { type: 'image/png' }))]);
  assert.equal(f.calls.writes, 1);
  assert.deepEqual(next.mediaIds, first.mediaIds);
  const changed = await f.codec.encode(new Blob(['实际修改的图片'], { type: 'image/png' }));
  assert.equal(f.calls.writes, 2);
  assert.notDeepEqual(changed.mediaIds, first.mediaIds);
});

test('同时上传同一内容共用在途ACK，失败后克隆内容仍会重新上传', async () => {
  const f = fixture(), a = new Blob(['相同内容']);
  await Promise.all([f.codec.encode(structuredClone(a)), f.codec.encode(structuredClone(a))]);
  assert.equal(f.calls.writes, 1);
  const g = fixture(); g.setFail(true);
  await assert.rejects(g.codec.encode(structuredClone(a)));
  g.setFail(false); await g.codec.encode(structuredClone(a));
  assert.equal(g.calls.writes, 2);
});

test('读验过的媒体换临时地址不会重新上传，错误ACK不能进入成功缓存', async () => {
  const blob = new Blob(['已存在的图片'], { type: 'image/png' });
  const id = createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
  let writes = 0;
  const codec = createValueCodec({client:{readMedia:async()=>blob,writeMedia:async()=>{writes++;return {id:'0'.repeat(64)};}},readBlobUrl:async()=>structuredClone(blob),createObjectURL:()=> 'blob:已读验'});
  await codec.decode(['blob-url',{mime:'image/png',size:blob.size,parts:[id]}]);
  assert.deepEqual((await codec.encode('blob:另一个恢复地址')).mediaIds,[id]);
  assert.equal(writes,0);
  await assert.rejects(codec.encode(new Blob(['新图片'])),error=>error.code==='invalid_ack');
  await assert.rejects(codec.encode(new Blob(['新图片'])),error=>error.code==='invalid_ack');
  assert.equal(writes,2);
});

test('重复媒体引用只保留一个媒体引用并复用同一个Blob', async () => {
  const f = fixture(), blob = new Blob([new Uint8Array(1024 * 1024)]);
  await f.codec.encode(blob);
  const repeated = Array(2048).fill(blob);
  const encoded = await f.codec.encode(repeated);
  assert.equal(encoded.mediaIds.length, 1);
  const decoded = await f.codec.decode(encoded.tree);
  assert.equal(decoded.length, repeated.length);
  assert.ok(decoded.every(item => item === decoded[0]));
  assert.equal(f.calls.writes, 1); assert.equal(f.calls.reads, 1);
  await assert.rejects(f.codec.encode({ token: 'blob:原图' }), error => error.code === 'secret_port_required');
  f.codec.close();
});

test('一键批量生成逐项保存超过1GiB的图片并为每次画布提交取得ACK', async () => {
  const chunkIds = new WeakMap(); let mediaWrites = 0, documentWrites = 0, rootWrites = 0;
  const imageCount = 40, imageBytes = 30 * 1024 * 1024;
  const images = Array.from({ length: imageCount }, (_, imageIndex) => {
    const image = { size: imageBytes, type: 'image/png', slice(start, end) {
      const chunk = { size: Math.max(0, Math.min(end, imageBytes) - start), type: 'application/octet-stream' };
      chunk.arrayBuffer = async () => {
        const bytes = new ArrayBuffer(chunk.size), view = new Uint8Array(bytes);
        view[0] = imageIndex + 1; view[1] = Math.floor(start / (16 * 1024 * 1024));
        chunkIds.set(chunk, createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
        return bytes;
      };
      return chunk;
    } };
    Object.setPrototypeOf(image, Blob.prototype);
    return image;
  });
  const client = {
    async readDocument() { return null; },
    async readForWrite() { return null; },
    async writeMedia(chunk) { mediaWrites++; return { id: chunkIds.get(chunk) }; },
    async writeDocument(write) {
      documentWrites++;
      if (write.value?.namespace === 'app_state' && write.value?.format === 'guan-app-storage.v2') rootWrites++;
      return { persisted: true, collection: write.collection, id: write.id, operationId: write.operationId,
        revision: write.expectedRevision + 1, hash: createHash('sha256').update(JSON.stringify(write.value)).digest('hex') };
    },
  };
  const storage = createShardedApplicationStorage({ client, requestLimit: 0, readBlobUrl: async url => images[Number(url.slice('blob:batch-'.length))] });
  const instance = storage.createInstance();
  const urls = [];
  for (let index = 0; index < imageCount; index++) {
    urls.push(`blob:batch-${index}`);
    await instance.setItem('infinite-canvas:canvas_store', JSON.stringify({ generatedBatch: urls }));
    assert.deepEqual(storage.getStatus(), { state: 'saved', pending: 0, reads: 0, errors: [], failures: [] }, `第${index + 1}张结果必须先保存确认`);
  }
  assert.equal(imageCount * imageBytes, 1200 * 1024 * 1024);
  assert.ok(imageCount * imageBytes > 1024 * 1024 * 1024);
  assert.equal(mediaWrites, imageCount * 2);
  assert.equal(rootWrites, imageCount);
  assert.ok(documentWrites > rootWrites);
  assert.deepEqual(storage.getStatus(), { state: 'saved', pending: 0, reads: 0, errors: [], failures: [] });
  storage.close();
});

test('解码不因整画布超过1GiB预先拒绝，仍逐片校验格式与大小', async () => {
  const reachedRead = Error('media-read-reached');
  const codec = createValueCodec({ client: { async readMedia() { throw reachedRead; } } });
  const size = 1024 * 1024 * 1024 + 1;
  const descriptor = ['blob', { mime: 'image/png', size,
    parts: Array.from({ length: Math.ceil(size / (16 * 1024 * 1024)) }, (_, index) => String(index + 1).padStart(64, '0')) }];
  await assert.rejects(codec.decode(descriptor), error => error === reachedRead);
  codec.close();
});

test('分片大小精确覆盖中文、代理项、转义、空容器及原内联深度边界', async () => {
  const values = [[], {}, ['中文😀\ud800\n"\\', true, null, -3.25], { 中文: ['a', {}] }];
  for (let depth = 29; depth <= 33; depth++) {
    let value = '深度'; for (let i = 0; i < depth; i++) value = [value]; values.push(value);
  }
  for (const value of values) {
    const plan = await buildFragmentPlan(value);
    assert.equal(plan.logicalBytes, Buffer.byteLength(JSON.stringify(value)));
    const actual = await readFragmentGraph({ head: plan.head, readDocument: async (collection, id) => ({ collection, id, value: plan.fragments.get(id).value, mediaIds: [] }) });
    assert.deepEqual(actual, value);
  }
});

const source = readFileSync(new URL('../扩展功能/本机存储/上游浏览器存储桥.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, '上游浏览器存储桥.ts', { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
async function bridge({ verifiedBaseline = false } = {}) {
  let time = 0, id = 0;
  const timers = new Map(), operations = [];
  const app = { createInstance: options => ({ iterate: async callback => {
    if (verifiedBaseline && options.storeName === 'app_state') callback('{"state":{"projects":[]}}', '画布', 1);
  }, setItem: (key, value) => new Promise((resolve, reject) => operations.push({ key, value, resolve, reject })) }),
    getStatus: () => ({ state: verifiedBaseline ? 'idle' : 'saved', pending: 0, errors: [] }), subscribe() {}, retryPending: async () => {}, flush: async () => {} };
  const module = { exports: {} }, window = { __guanSQLiteHost: { initialize: async () => app }, dispatchEvent() {}, addEventListener() {} };
  new Function('module', 'exports', 'window', 'setTimeout', 'clearTimeout', 'performance', code)(module, module.exports, window,
    (run, delay) => { const key = ++id; timers.set(key, { run, at: time + delay }); return key; }, key => timers.delete(key), { now: () => time });
  await module.exports.initializeSQLiteApplication();
  function advance(ms) {
    const until = time + ms;
    while (true) { const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!next || next[1].at > until) break;
      time = next[1].at; timers.delete(next[0]); next[1].run(); }
    time = until;
  }
  return { ...module.exports, operations, advance };
}

test('短编辑80ms提交，真正ACK之前持续显示保存中', async () => {
  const b = await bridge(), save = b.scheduleStateSave('画布', '第一稿');
  b.advance(79); assert.equal(b.operations.length, 0); assert.equal(b.storageStatus().state, 'saving');
  b.advance(1); assert.equal(b.operations.length, 1); assert.equal(b.storageStatus().state, 'saving');
  b.operations[0].resolve(); await save; await Promise.resolve();
  assert.equal(b.storageStatus().state, 'saved');
});

test('刷新完整读验的基线是已保存，新编辑与失败仍不能冒充已保存', async () => {
  const b = await bridge({ verifiedBaseline: true });
  assert.equal(b.storageStatus().state, 'saved'); assert.equal(b.operations.length, 0);
  const save = b.scheduleStateSave('画布', '新稿'); assert.equal(b.storageStatus().state, 'saving');
  b.advance(80); assert.equal(b.storageStatus().state, 'saving');
  b.operations[0].reject(Error('合成离线')); await assert.rejects(save); await Promise.resolve();
  assert.equal(b.storageStatus().state, 'error');
});

test('持续输入最迟250ms提交最新合并稿，flush不等待计时器', async () => {
  const b = await bridge(); let save;
  for (let i = 0; i < 5; i++) { save = b.scheduleStateSave('画布', String(i)); b.advance(50); }
  assert.equal(b.operations.length, 1); assert.equal(b.operations[0].value, '4');
  b.operations[0].resolve(); await save;
  const last = b.scheduleStateSave('画布', '最终稿'), flush = b.flushSQLiteStorage();
  assert.equal(b.operations.length, 2); b.operations[1].resolve(); await last; await flush;
  assert.equal(b.storageStatus().state, 'saved');
});

test('失败不提前显示已保存，flush拒绝未确认的数据', async () => {
  const b = await bridge(), save = b.scheduleStateSave('画布', '未确认稿'); b.advance(80);
  b.operations[0].reject(Error('合成离线')); await assert.rejects(save); await Promise.resolve();
  assert.equal(b.storageStatus().state, 'error'); await assert.rejects(b.flushSQLiteStorage());
});

test('慢提交期间连续编辑只留下一份最新候选，flush等两代真实ACK', async () => {
  const b = await bridge(), first = b.scheduleStateSave('画布', '开始'); b.advance(80);
  let latest;
  for (let i = 0; i < 20; i++) { latest = b.scheduleStateSave('画布', '最新' + i); b.advance(50); }
  assert.equal(b.operations.length, 1, '不能把过时快照堆进底层FIFO');
  let flushed = false; const flush = b.flushSQLiteStorage().then(() => { flushed = true; });
  b.operations[0].resolve(); await first; await Promise.resolve();
  assert.equal(b.operations.length, 2); assert.equal(b.operations[1].value, '最新19');
  assert.equal(flushed, false); assert.equal(b.storageStatus().state, 'saving');
  b.operations[1].resolve(); await latest; await flush;
  assert.equal(b.storageStatus().state, 'saved'); assert.equal(flushed, true);
});

test('分片最多四路并发，失败等待同批收口，原操作重试后才发布根目录', async () => {
  const documents = new Map(), writes = [], held = [];
  let ready; const firstBatch = new Promise(resolve => { ready = resolve; });
  let fail = true, settled = false, roots = 0;
  const client = {
    async readDocument(_collection, id) { return documents.get(id) ?? null; },
    async writeDocument(write) {
      writes.push(write);
      if (write.id.startsWith('app-part-') && held.length < 4) {
        const index = held.length;
        await new Promise(resolve => { held.push(resolve); if (held.length === 4) ready(); });
        if (index === 0 && fail) { fail = false; throw Error('合成分片断线'); }
      }
      if (!write.id.startsWith('app-part-')) roots++;
      const hash = createHash('sha256').update(JSON.stringify(write.value)).digest('hex');
      documents.set(write.id, { collection: write.collection, id: write.id, value: write.value, mediaIds: write.mediaIds, revision: write.expectedRevision + 1 });
      return { ...write, persisted: true, revision: write.expectedRevision + 1, hash };
    },
  };
  const app = createShardedApplicationStorage({ client }), instance = app.createInstance();
  const save = instance.setItem('infinite-canvas:canvas_store', syntheticCanvas({ products: 2, nodes: 200, textLength: 2000 }));
  save.then(() => { settled = true; }, () => { settled = true; });
  await firstBatch; assert.equal(held.length, 4); assert.equal(roots, 0);
  held[0](); await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, '失败不能留下同批仍运行的请求');
  for (const release of held.slice(1)) release();
  await assert.rejects(save, /合成分片断线/); assert.equal(roots, 0);
  const original = writes[0]; await app.retry('app_state'); await app.flush();
  assert.equal(roots, 1);
  const retry = writes.filter(write => write.id === original.id);
  assert.equal(retry.length, 2); assert.equal(retry[0].operationId, retry[1].operationId);
  for (const saved of writes.slice(1, 4)) assert.equal(writes.filter(write => write.id === saved.id).length, 1);
  app.close();
});
