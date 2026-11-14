import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { buildFragmentPlan, readFragmentGraph } from '../扩展功能/本机存储/分片值编码.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';
import { syntheticCanvas } from './分片合成数据.mjs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import * as upgradeState from '../扩展功能/软件更新/升级页面状态.mjs';

function fixture() {
  const media = new Map(), calls = { writes: 0, reads: 0, urls: 0 }, revoked = [];
  let fail = false;
  const codec = createValueCodec({
    client: {
      async writeMedia(blob) {
        calls.writes++; if (fail) throw Error('合成写入失败');
        const id = createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
        media.set(id, blob); return { id, size: blob.size };
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
    client: { readMedia: async () => blob, writeMedia: async media => ({ id, size: media.size }) },
    readBlobUrl: async () => { reads++; return blob; },
  });
  await codec.encode({ storageKey: 'image:稳定', bytes: blob.size, mimeType: blob.type, content: 'blob:第一地址' });
  await codec.encode({ storageKey: 'image:稳定', bytes: blob.size, mimeType: blob.type, content: 'blob:第二地址' });
  assert.equal(reads, 1);
  codec.close();
});

test('冷读取恢复的URL复用单体媒体，缓存不泄露可变描述', async () => {
  const f = fixture(), encoded = await f.codec.encode({ url: 'blob:原图' });
  const restored = await f.codec.decode(encoded.tree), before = { ...f.calls };
  encoded.tree[1][0][1][1].id = '0'.repeat(64);
  const next = await f.codec.encode(restored);
  assert.deepEqual(f.calls, before);
  assert.notEqual(next.mediaIds[0], '0'.repeat(64));
  next.tree[1][0][1][1].id = '0'.repeat(64);
  assert.notEqual((await f.codec.encode(restored)).mediaIds[0], '0'.repeat(64));
  f.codec.close(); assert.deepEqual(f.revoked, ['blob:已恢复图片']);
});

test('媒体失败没有缓存成功标志，重试必须重新取得ACK', async () => {
  const f = fixture(); f.setFail(true);
  await assert.rejects(f.codec.encode('blob:原图'), /合成写入失败/);
  f.setFail(false); await f.codec.encode('blob:原图');
  assert.equal(f.calls.writes, 2); assert.equal(f.calls.urls, 2);
});

test('编码拒绝非法对象时不遗留未完成的媒体ACK，后续有效保存可继续', async () => {
  const f = fixture(), blob = new Blob(['有效图片']);
  await assert.rejects(f.codec.encode({ image: blob, unsupported: new Map() }), error => error.code === 'invalid_value');
  assert.equal(f.calls.writes, 0);
  const saved = await f.codec.encode(blob);
  assert.equal(saved.mediaIds.length, 1);
  assert.equal(f.calls.writes, 1);
  f.codec.close();
});

test('不可变Blob复用，可变ArrayBuffer修改后重新写入', async () => {
  const f = fixture(), blob = new Blob(['图像']), bytes = new Uint8Array([1, 2]);
  await f.codec.encode([blob, blob]); assert.equal(f.calls.writes, 1);
  const a = await f.codec.encode(bytes.buffer); bytes[0] = 3;
  const b = await f.codec.encode(bytes.buffer);
  assert.notDeepEqual(a.mediaIds, b.mediaIds); assert.equal(f.calls.writes, 3);
});

test('多张几MiB图片按完整文件成组上传，减少逐图请求并取得每张图片ACK', async () => {
  const batches = [];
  const images = Array.from({ length: 10 }, (_, index) => new Blob([Buffer.alloc(2 * 1024 * 1024, index + 1)], { type: 'image/png' }));
  const codec = createValueCodec({ client: {
    async writeMedia() { assert.fail('多图保存应使用批次接口'); },
    async writeMediaBatch(items) {
      batches.push(items.map(item => item.blob.size));
      return Promise.all(items.map(async ({ blob }) => ({
        id: createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'),
        size: blob.size,
      })));
    },
  } });
  const encoded = await codec.encode({ images });
  assert.deepEqual(batches, [Array(8).fill(2 * 1024 * 1024), Array(2).fill(2 * 1024 * 1024)]);
  assert.equal(encoded.mediaIds.length, images.length);
  assert.equal(new Set(encoded.mediaIds).size, images.length);
  codec.close();
});

test('同一URL与同一Blob分别复用上传确认，克隆Blob交由SQLite按内容寻址去重', async () => {
  const f = fixture();
  const blob = new Blob(['合成图片'], { type: 'image/png' });
  const first = await f.codec.encode(['blob:原图', blob]);
  const next = await f.codec.encode(['blob:原图', blob]);
  assert.equal(f.calls.writes, 2, 'URL解码和独立Blob各上传一次，重复保存复用其身份');
  assert.deepEqual(next.mediaIds, first.mediaIds);
  const clone = await f.codec.encode(structuredClone(blob));
  assert.equal(f.calls.writes, 3, '避免浏览器端预先读取/哈希克隆Blob；服务端仍按哈希去重');
  assert.deepEqual(clone.mediaIds, first.mediaIds);
  const changed = await f.codec.encode(new Blob(['实际修改的图片'], { type: 'image/png' }));
  assert.equal(f.calls.writes, 4);
  assert.notDeepEqual(changed.mediaIds, first.mediaIds);
});

test('同时保存同一Blob身份共用在途ACK，失败后重试并克隆媒体重新上传', async () => {
  const f = fixture(), a = new Blob(['相同内容']);
  await Promise.all([f.codec.encode(a), f.codec.encode(a)]);
  assert.equal(f.calls.writes, 1);
  const g = fixture(); g.setFail(true);
  await assert.rejects(g.codec.encode(structuredClone(a)));
  g.setFail(false); await g.codec.encode(structuredClone(a));
  assert.equal(g.calls.writes, 2);
  await g.codec.encode(structuredClone(a));
  assert.equal(g.calls.writes, 3);
});

test('旧分片媒体可冷读，下一次保存转成单体媒体且错误ACK不缓存', async () => {
  const blob = new Blob(['已存在的图片'], { type: 'image/png' });
  const id = createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
  let writes = 0, reads = 0, rejectAck = true;
  const codec = createValueCodec({
    client: {
      async readMedia() { reads++; return blob; },
      async writeMedia(media) {
        writes++;
        return { id, size: rejectAck ? media.size + 1 : media.size };
      },
    },
    readBlobUrl: async () => structuredClone(blob),
    createObjectURL: () => 'blob:已读验',
  });
  const url = await codec.decode(['blob-url', { mime: blob.type, size: blob.size, parts: [id] }]);
  assert.equal(reads, 1);
  await assert.rejects(codec.encode(url), error => error.code === 'invalid_ack');
  rejectAck = false;
  const saved = await codec.encode(url);
  assert.equal(writes, 2);
  assert.deepEqual(saved.mediaIds, [id]);
  assert.ok(Object.hasOwn(saved.tree[1], 'id'), '旧parts格式必须在新保存时转成单体描述');
  assert.equal((await codec.encode(url)).tree[1].id, id, '同一临时地址之后应复用已确认的单体媒体');
  assert.equal(writes, 2);
  codec.close();
});

test('旧parts格式冷读后，下次保存转成一个单体媒体BLOB', async () => {
  const blob = new Blob(['旧版16MiB分片内容'], { type: 'image/png' });
  const id = createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
  let writes = 0;
  const codec = createValueCodec({
    client: {
      async readMedia(readId) { assert.equal(readId, id); return blob; },
      async writeMedia(media) {
        writes++;
        return { id: createHash('sha256').update(Buffer.from(await media.arrayBuffer())).digest('hex'), size: media.size };
      },
    },
  });
  const restored = await codec.decode(['blob', { mime: blob.type, size: blob.size, parts: [id] }]);
  assert.equal(writes, 0);
  const encoded = await codec.encode(restored);
  assert.equal(writes, 1);
  assert.deepEqual(encoded.mediaIds, [id]);
  assert.deepEqual(Object.keys(encoded.tree[1]).sort(), ['id', 'mime', 'size']);
  codec.close();
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
  const imageIds = new WeakMap(); let mediaWrites = 0, documentWrites = 0, rootWrites = 0;
  const imageCount = 40, imageBytes = 30 * 1024 * 1024;
  const images = Array.from({ length: imageCount }, (_, imageIndex) => {
    const image = {
      size: imageBytes,
      type: 'image/png',
      slice() { throw Error('媒体上传不应切成多份'); },
      async arrayBuffer() { throw Error('媒体不应先整块读取到浏览器内存'); },
    };
    Object.setPrototypeOf(image, Blob.prototype);
    imageIds.set(image, createHash('sha256').update(`synthetic-image-${imageIndex}`).digest('hex'));
    return image;
  });
  const client = {
    async readDocument() { return null; },
    async readForWrite() { return null; },
    async writeMedia(image) { mediaWrites++; return { id: imageIds.get(image), size: image.size }; },
    async writeDocument(write) {
      documentWrites++;
      if (write.value?.namespace === 'app_state' && write.value?.format === 'guan-app-storage.v2') rootWrites++;
      return { persisted: true, collection: write.collection, id: write.id, operationId: write.operationId,
        revision: write.expectedRevision + 1, hash: createHash('sha256').update(JSON.stringify(write.value)).digest('hex') };
    },
  };
  const storage = createShardedApplicationStorage({ client, requestLimit: 0, readBlobUrl: async url => images[Number(url.slice('blob:batch-'.length))] });
  const instance = storage.createInstance(), urls = [];
  for (let index = 0; index < imageCount; index++) {
    urls.push(`blob:batch-${index}`);
    await instance.setItem('infinite-canvas:canvas_store', JSON.stringify({ generatedBatch: urls }));
    assert.deepEqual(storage.getStatus(), { state: 'saved', pending: 0, reads: 0, errors: [], failures: [] }, `第${index + 1}张结果必须先保存确认`);
  }
  assert.equal(imageCount * imageBytes, 1200 * 1024 * 1024);
  assert.ok(imageCount * imageBytes > 1024 * 1024 * 1024);
  assert.equal(mediaWrites, imageCount, '每个原图只执行一次媒体写入');
  assert.equal(rootWrites, imageCount);
  assert.ok(documentWrites > rootWrites);
  storage.close();
});

test('画布总媒体超过1GiB时继续逐片读取，保持单片大小校验', async () => {
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
async function bridge({ verifiedBaseline = false, autoAck = false, failSynchronously = () => false } = {}) {
  let time = 0, id = 0;
  const timers = new Map(), operations = [];
  const app = { createInstance: options => ({ iterate: async callback => {
    if (verifiedBaseline && options.storeName === 'app_state') callback('{"state":{"projects":[]}}', '画布', 1);
  }, setItem: (key, value) => {
    if (failSynchronously()) throw Error('合成提交前同步失败');
    return new Promise((resolve, reject) => {
      operations.push({ key, value, resolve, reject });
      if (autoAck) queueMicrotask(resolve);
    });
  } }),
    getStatus: () => ({ state: verifiedBaseline ? 'idle' : 'saved', pending: 0, errors: [] }), subscribe() {}, retryPending: async () => {}, flush: async () => {} };
  const module = { exports: {} }, window = { __guanSQLiteHost: { initialize: async () => app }, dispatchEvent() {}, addEventListener() {} };
  new Function('module', 'exports', 'window', 'setTimeout', 'clearTimeout', 'performance', 'require', code)(module, module.exports, window,
    (run, delay) => { const key = ++id; timers.set(key, { run, at: time + delay }); return key; }, key => timers.delete(key), { now: () => time },
    id => { if (id === '../Excel画布/平台规则全局状态') return { globalPlatformRules: { initialize: async () => {} } };
      assert.equal(id, '../软件更新/升级页面状态.mjs'); return upgradeState; });
  await module.exports.initializeSQLiteApplication();
  function advance(ms) {
    const until = time + ms;
    while (true) { const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!next || next[1].at > until) break;
      time = next[1].at; timers.delete(next[0]); next[1].run(); }
    time = until;
  }
  return { ...module.exports, operations, advance };
}

const canvasRequire = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const canvasStoreSource = readFileSync(new URL('../.运行/3100源/画布副本/web/src/stores/canvas/use-canvas-store.ts', import.meta.url), 'utf8');
const { code: canvasStoreCode } = await transformWithEsbuild(canvasStoreSource, 'use-canvas-store.ts', { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
async function canvasStore(b, initial = { state: { projects: [], deletedProjects: [], guanWorkbooks: null }, version: 0 }) {
  const stats = { encodings: 0, milliseconds: 0 };
  const { createStore } = canvasRequire('zustand/vanilla');
  const dependencies = {
    zustand: { create: () => initializer => createStore(initializer) },
    'zustand/middleware': canvasRequire('zustand/middleware'),
    nanoid: { nanoid: () => 'product' },
    '@/扩展功能/本机存储/上游浏览器存储桥': b,
    '@/扩展功能/画布生成/批量保存协调': { shouldDeferCanvasPersist: () => false },
    '@/扩展功能/图片设置/图片信息偏好': { imageInfoDefaults: {}, withCanvasAppearanceDefaults: value => value },
    '@/扩展功能/产品配置/功能开关': { productFeatures: { excel: false } },
    '@/扩展功能/Excel/Excel产品归属': { assertWorkbookSnapshot() {}, currentWorkbookId: () => null, normalizeExcelCanvasTitles: state => state.projects },
    '@/扩展功能/产品/产品规则': { nextProductTitle: () => '测试产品' },
    '@/i18n': { default: { t: value => value } },
    '@/lib/localforage-storage': { localForageStorage: { getItem: async () => JSON.stringify(initial), removeItem: async () => {} } },
  };
  const module = { exports: {} };
  new Function('module', 'exports', 'require', 'JSON', canvasStoreCode)(module, module.exports,
    id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; },
    { parse: JSON.parse, stringify(value) {
      const started = performance.now();
      stats.encodings++;
      try { return JSON.stringify(value); } finally { stats.milliseconds += performance.now() - started; }
    } });
  const store = module.exports.useCanvasStore;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.persist.hasHydrated(), true);
  await b.flushSQLiteStorage();
  stats.encodings = 0; stats.milliseconds = 0; b.operations.length = 0;
  return { store, stats };
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

test('真实Zustand连续100次编辑只编码最终画布一次，非持久化状态不触发编码', async () => {
  const b = await bridge({ autoAck: true }), { store, stats } = await canvasStore(b);
  store.getState().createProject();
  for (let i = 0; i < 100; i++) store.getState().updateProject('product', { viewport: { x: i, y: -i, k: 1 } });
  for (let i = 0; i < 100; i++) store.setState({ hydrated: !!(i % 2) });
  assert.equal(stats.encodings, 0, '编辑和排队阶段不应遍历画布');
  assert.equal(b.operations.length, 0);
  b.advance(79); assert.equal(stats.encodings, 0);
  b.advance(1); await b.flushSQLiteStorage();
  assert.equal(stats.encodings, 1); assert.equal(b.operations.length, 1);
  assert.deepEqual(JSON.parse(b.operations[0].value).state.projects[0].viewport, { x: 99, y: -99, k: 1 });
  for (let i = 0; i < 100; i++) store.setState({ hydrated: !!(i % 2) });
  await b.flushSQLiteStorage();
  assert.equal(stats.encodings, 1, '只切换运行状态不应再编码');
});

test('延迟编码仍遵守250ms最长等待，立即保存不等待防抖', async () => {
  const b = await bridge({ autoAck: true });
  let encodings = 0, save;
  for (let i = 0; i < 5; i++) {
    save = b.scheduleStateSave('画布', () => { encodings++; return String(i); });
    b.advance(50);
  }
  assert.equal(encodings, 1); assert.equal(b.operations[0].value, '4'); await save;
  const final = b.scheduleStateSave('画布', () => { encodings++; return '最后一稿'; });
  const flush = b.flushSQLiteStorage();
  assert.equal(encodings, 2); await final; await flush;
  assert.equal(b.operations[1].value, '最后一稿');
});

test('慢写入期间20份候选不编码，只编码最新一份且旧请求内容不变', async () => {
  const b = await bridge(); let encodings = 0;
  const first = b.scheduleStateSave('画布', () => { encodings++; return '在途快照'; });
  b.advance(80);
  let latest;
  for (let i = 0; i < 20; i++) {
    latest = b.scheduleStateSave('画布', () => { encodings++; return `新稿${i}`; });
    b.advance(50);
  }
  assert.equal(encodings, 1); assert.equal(b.operations.length, 1);
  assert.equal(b.operations[0].value, '在途快照');
  const flush = b.flushSQLiteStorage();
  b.operations[0].resolve(); await first;
  assert.equal(encodings, 2); assert.equal(b.operations[1].value, '新稿19');
  b.operations[1].resolve(); await latest; await flush;
});

test('编码失败保留快照并阻止已保存误报；重试重新编码且等待真正ACK', async () => {
  const b = await bridge(); let invalid = true, encodings = 0;
  const save = b.scheduleStateSave('画布', () => {
    encodings++;
    if (invalid) throw Error('合成编码失败');
    return '有效画布';
  });
  b.advance(80); await assert.rejects(save, /合成编码失败/);
  assert.equal(b.operations.length, 0);
  assert.equal(b.storageStatus().state, 'error'); assert.equal(b.storageStatus().pending, 1);
  await assert.rejects(b.flushSQLiteStorage());
  await assert.rejects(b.retrySQLiteStorage(), /编码失败/);
  assert.equal(b.storageStatus().state, 'error'); assert.equal(encodings, 2);
  invalid = false;
  const retry = b.retrySQLiteStorage();
  assert.equal(b.operations.length, 1); assert.equal(b.storageStatus().state, 'saving');
  b.operations[0].resolve(); await retry; await b.flushSQLiteStorage();
  assert.equal(encodings, 3); assert.equal(b.storageStatus().state, 'saved');
});

test('编码失败后新编辑替代旧候选，重试不恢复过时内容', async () => {
  const b = await bridge({ autoAck: true });
  let staleEncodings = 0;
  const old = b.scheduleStateSave('画布', () => { staleEncodings++; throw Error('旧快照非法'); });
  b.advance(80); await assert.rejects(old);
  const latest = b.scheduleStateSave('画布', () => '修正后的最新内容');
  await b.retrySQLiteStorage(); await latest;
  assert.equal(staleEncodings, 1); assert.equal(b.operations.length, 1);
  assert.equal(b.operations[0].value, '修正后的最新内容');
  assert.equal(b.storageStatus().state, 'saved');
});

test('提交前同步失败保留已编码候选，重试不因缓存相同而跳过真正提交', async () => {
  let fail = true, encodings = 0;
  const b = await bridge({ autoAck: true, failSynchronously: () => fail });
  const save = b.scheduleStateSave('画布', () => { encodings++; return '尚未提交的画布'; });
  b.advance(80); await assert.rejects(save, /同步失败/);
  assert.equal(b.storageStatus().state, 'error'); assert.equal(b.operations.length, 0);
  await assert.rejects(b.retrySQLiteStorage());
  assert.equal(b.storageStatus().state, 'error');
  fail = false; await b.retrySQLiteStorage(); await b.flushSQLiteStorage();
  assert.equal(encodings, 1); assert.equal(b.operations.length, 1);
  assert.equal(b.operations[0].value, '尚未提交的画布');
  assert.equal(b.storageStatus().state, 'saved');
});

test('5000节点100次连续编辑，编码次数由100次降到1次且最终内容一致', async t => {
  const initial = JSON.parse(syntheticCanvas({ products: 20, nodes: 250, textLength: 1000 }));
  initial.state.guanWorkbooks = null;
  const b = await bridge({ autoAck: true }), { store, stats } = await canvasStore(b, initial);
  let eagerMilliseconds = 0, expected;
  for (let i = 0; i < 100; i++) {
    store.getState().updateProject('p-0', { viewport: { x: i, y: 0, k: 1 } });
    const { projects, deletedProjects, guanWorkbooks } = store.getState();
    const started = performance.now();
    expected = JSON.stringify({ state: { projects, guanWorkbooks, deletedProjects }, version: 0 });
    eagerMilliseconds += performance.now() - started;
  }
  assert.equal(stats.encodings, 0);
  await b.flushSQLiteStorage();
  assert.equal(stats.encodings, 1); assert.equal(b.operations.length, 1);
  assert.equal(b.operations[0].value, expected);
  t.diagnostic(JSON.stringify({ nodes: 5000, edits: 100, bytes: Buffer.byteLength(expected), eagerEncodings: 100, deferredEncodings: stats.encodings,
    eagerEncodingMs: +eagerMilliseconds.toFixed(2), deferredEncodingMs: +stats.milliseconds.toFixed(2) }));
});

test('批量保存期间其他卡片状态更新时，同一产品只写入最新快照', async () => {
  const path = '../扩展功能/产品/产品保存检查点.ts';
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { code } = await transformWithEsbuild(source, path, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  const requested = [], checkpoint = new module.exports.ProductCommitCheckpoint(ticket => requested.push(ticket));
  checkpoint.mount();
  checkpoint.commit(0, { baseline: true }, true);
  checkpoint.commit(0, { revision: 1 }, true);
  const saved = []; let release;
  const first = checkpoint.flush(async value => {
    saved.push(value);
    if (value.revision === 1) await new Promise(resolve => { release = resolve; });
  });
  await new Promise(resolve => setImmediate(resolve));
  checkpoint.commit(requested.at(-1), { revision: 1 }, true);
  await new Promise(resolve => setImmediate(resolve));
  const concurrent = checkpoint.flush(async value => saved.push(value));
  const latest = { revision: 2 };
  checkpoint.commit(requested.at(-1), latest, true); release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requested.length, 2);
  checkpoint.commit(requested.at(-1), latest, true);
  await Promise.all([first, concurrent]);
  assert.deepEqual(saved, [{ revision: 1 }, latest]);
  checkpoint.unmount();
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

test('单体内容块失败不发布根目录，同操作重试后才确认保存', { timeout: 10_000 }, async () => {
  const documents = new Map(), writes = [];
  let ready; const firstBatch = new Promise(resolve => { ready = resolve; });
  let fail = true, settled = false, roots = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const client = {
    async readDocument(_collection, id) { return documents.get(id) ?? null; },
    async writeDocument(write) {
      writes.push(write);
      if (write.id.startsWith('app-part-') && fail) {
        ready(); await held;
        fail = false; throw Error('合成分片断线');
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
  await firstBatch; assert.equal(roots, 0); assert.equal(settled, false);
  release();
  await assert.rejects(save, /合成分片断线/); assert.equal(roots, 0);
  const original = writes[0]; await app.retry('app_state'); await app.flush();
  assert.equal(roots, 1);
  const retry = writes.filter(write => write.id === original.id);
  assert.equal(retry.length, 2); assert.equal(retry[0].operationId, retry[1].operationId);
  app.close();
});
