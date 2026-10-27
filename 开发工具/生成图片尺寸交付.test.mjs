import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { parseDeliverySize, deliveryAction, prepareGeneratedDelivery } from '../扩展功能/媒体交付/生成图片尺寸交付.mjs';
import { prepareCompatibleImage } from '../扩展功能/媒体交付/HEIC上传兼容.mjs';

globalThis.window = { setTimeout, clearTimeout };
const original = new Blob(['upstream-original'], { type: 'image/webp' });
const encoded = new Blob(['delivery-png'], { type: 'image/png' });
let encodeError = false, onEncode, closed = 0, draws = [];
// 绘制边界可观察，Blob 保存使用完整实际存储函数；不提交模型请求。
globalThis.createImageBitmap = async () => ({ close() { closed++; } });
globalThis.document = { createElement() { return {
  width: 0, height: 0,
  getContext() { return { imageSmoothingEnabled: false, imageSmoothingQuality: 'low', drawImage(...args) {
    assert.equal(this.imageSmoothingEnabled, true); assert.equal(this.imageSmoothingQuality, 'high'); draws.push(args.slice(1));
  } }; },
  toBlob(callback, mime) { assert.equal(mime, 'image/png'); onEncode?.(); callback(encodeError ? null : encoded); },
}; } };

async function fixture({ width = 1086, height = 1448, failAt, failFetch = false, compatible = prepareCompatibleImage, abortOnWrite } = {}) {
  const media = new Map(), writes = [], removed = [], urls = new Map();
  const { code } = await transformWithEsbuild(await readFile(new URL('../.运行/3100源/画布副本/web/src/services/image-storage.ts', import.meta.url), 'utf8'), 'storage.ts', { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
  let id = 0;
  const dependencies = {
    '@/扩展功能/媒体交付/媒体地址缓存': { createMediaUrlCache: () => ({ set() {}, get() {}, delete() {} }) },
    '@/扩展功能/网络代理/本地转发请求': { 本地转发请求: async () => { if (failFetch) throw Error('network'); return new Response(original); } },
    '@/扩展功能/本机存储/上游浏览器存储桥': { sqliteForage: { createInstance: ({ storeName }) => ({
      async setItem(key, blob) { if (storeName !== 'image_files') return; writes.push(key); if (writes.length === failAt) throw Error('disk full'); media.set(key, blob); abortOnWrite?.(); },
      async getItem(key) { return media.get(key); },
      async removeItem(key) { removed.push(key); media.delete(key); },
    }) } },
    nanoid: { nanoid: () => String(++id) },
    '@/扩展功能/画布迁移扩展/内嵌图片解码.mjs': { decodeInlineImage: () => original },
    '@/扩展功能/安全与批量/persistence-checkpoint': { createPersistenceCheckpoint: () => ({ run: (_key, fn) => fn() }) },
    '@/扩展功能/安全与批量/settle-activity-group': {},
    '@/i18n': { default: { t: value => value } },
    '@/扩展功能/媒体交付/图片上传预检.mjs': { preflightImageUpload: async () => ({ width, height }) },
    '@/扩展功能/媒体交付/HEIC上传兼容.mjs': { prepareCompatibleImage: compatible },
    '@/扩展功能/媒体交付/生成图片尺寸交付.mjs': { parseDeliverySize, prepareGeneratedDelivery },
    '@/stores/use-config-store': { withLocalProxy: value => value },
    '@/lib/image-thumbnail': { createImageThumbnail: async () => undefined },
  };
  const module = { exports: {} };
  const URLPort = { createObjectURL(blob) { const url = 'blob:' + urls.size; urls.set(url, blob); return url; }, revokeObjectURL(url) { urls.delete(url); } };
  new Function('require', 'module', 'exports', 'URL', code)(name => {
    assert.ok(name in dependencies, '未声明依赖：' + name); return dependencies[name];
  }, module, module.exports, URLPort);
  return { ...module.exports, media, writes, removed, urls };
}

test('原始900×1200无需对齐16；比例/auto没有交付目标，尺寸上限受保护', () => {
  for (const value of ['900x1200', '900 × 1200', '900 X 1200']) assert.deepEqual(parseDeliverySize(value), { width: 900, height: 1200 });
  for (const value of ['auto', '3:4', '', '0x10']) assert.equal(parseDeliverySize(value), undefined);
  assert.throws(() => parseDeliverySize('50000x50000'), /过大/);
  assert.equal(deliveryAction(1086, 1448, parseDeliverySize('900x1200')), 'resize');
  assert.equal(deliveryAction(1280, 800, parseDeliverySize('800x500')), 'resize');
  assert.equal(deliveryAction(1024, 1024, parseDeliverySize('900x1200')), 'ratio-mismatch');
  assert.equal(deliveryAction(1093, 1439, parseDeliverySize('900x1200')), 'ratio-mismatch');
});

test('上游1086×1448交付900×1200，完整原字节和PNG交付图只保存两个键', async () => {
  const f = await fixture(), before = closed;
  const result = await f.uploadGeneratedImage(original, { targetSize: '900x1200' });
  assert.equal(result.width, 900); assert.equal(result.height, 1200);
  assert.equal(result.originalWidth, 1086); assert.equal(result.originalHeight, 1448);
  assert.equal(result.mimeType, 'image/png'); assert.equal(result.originalMimeType, 'image/webp');
  assert.equal(f.media.get(result.originalStorageKey), original);
  assert.equal(f.media.get(result.deliveryStorageKey), encoded);
  assert.equal(result.storageKey, result.deliveryStorageKey); assert.equal(f.media.size, 2);
  assert.equal(result.bytes, encoded.size); assert.equal(result.originalBytes, original.size);
  assert.match(result.deliveryNote, /另行保留/); assert.deepEqual(draws.at(-1), [0, 0, 900, 1200]);
  assert.equal(closed, before + 1); assert.equal(f.urls.size, 1);
});

test('精确尺寸不重新编码；比例不符保留原字节并给出说明；普通上传不缩放', async () => {
  for (const [width, height, target] of [[900,1200,'900x1200'], [1086,1448,'auto'], [1086,1448,'3:4'], [1024,1024,'900x1200']]) {
    const f = await fixture({ width, height }), count = draws.length;
    const result = await f.uploadGeneratedImage(original, { targetSize: target });
    assert.equal(result.width, width); assert.equal(result.height, height);
    assert.equal(f.media.get(result.storageKey), original); assert.equal(draws.length, count);
    if (width === 1024) assert.match(result.deliveryNote, /未拉伸或裁切/);
  }
  const f = await fixture(), result = await f.uploadImage(original);
  assert.equal(result.width, 1086); assert.equal(f.media.get(result.storageKey), original);
});

test('第二个写入失败和落盘期间取消会清理本次两键及对象地址，不留半份结果', async () => {
  const full = await fixture({ failAt: 2 });
  await assert.rejects(full.uploadGeneratedImage(original, { targetSize: '900x1200' }), /disk full/);
  assert.equal(full.media.size, 0); assert.equal(full.urls.size, 0); assert.equal(full.removed.length, 2);
  const controller = new AbortController(), cancelled = await fixture({ abortOnWrite: () => controller.abort() });
  await assert.rejects(cancelled.uploadGeneratedImage(original, { targetSize: '900x1200', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(cancelled.media.size, 0); assert.equal(cancelled.urls.size, 0);
});

test('取消或PNG编码失败不开始落盘，释放解码图；可继续保存下一张', async () => {
  const f = await fixture(), controller = new AbortController(), before = closed;
  controller.abort();
  await assert.rejects(f.uploadGeneratedImage(original, { targetSize: '900x1200', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.writes.length, 0);
  encodeError = true;
  try { await assert.rejects(f.uploadGeneratedImage(original, { targetSize: '900x1200' }), /编码失败/); }
  finally { encodeError = false; }
  assert.equal(closed, before + 1); assert.equal(f.writes.length, 0); assert.equal(f.urls.size, 0);
  const late = new AbortController(); onEncode = () => late.abort();
  try { await assert.rejects(f.uploadGeneratedImage(original, { targetSize: '900x1200', signal: late.signal }), { name: 'AbortError' }); }
  finally { onEncode = undefined; }
  assert.equal(f.writes.length, 0);
  assert.equal((await f.uploadGeneratedImage(original, { targetSize: '900x1200' })).width, 900);
});

test('远程生成图下载失败必须失败，不能以远端URL冒充已保存', async () => {
  const f = await fixture({ failFetch: true });
  await assert.rejects(f.uploadGeneratedImage('https://example.invalid/image.png', { targetSize: '900x1200' }), /network/);
  assert.equal(f.writes.length, 0);
});

test('HEIC原字节保留，JPEG兼容图仍可按生成交付尺寸处理', async () => {
  const heic = new Blob([Buffer.from('000000186674797068656963000000006d69663168656963', 'hex')], { type: 'image/heic' });
  const f = await fixture({ compatible: (blob, options) => prepareCompatibleImage(blob, { ...options, host: { convertHeic: async () => original } }) });
  const result = await f.uploadGeneratedImage(heic, { targetSize: '900x1200' });
  assert.equal(f.media.get(result.originalStorageKey), heic); assert.equal(result.originalMimeType, 'image/heic');
  assert.equal(f.media.get(result.storageKey), encoded); assert.equal(result.width, 900);
});

test('真实PNG像素处理：1086×1448到900×1200，透明像素保留，原图字节不变', { skip: !process.env.GUAN_CANVAS_MODULES }, async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(process.env.GUAN_CANVAS_MODULES + '/package.json');
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const { createHash } = await import('node:crypto');
  const { resizeDeliveryBlob } = await import('../扩展功能/媒体交付/生成图片尺寸交付.mjs');
  const canvas = createCanvas(1086, 1448), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ee4d45'; ctx.fillRect(100, 100, 886, 1248);
  const bytes = await canvas.encode('png'), hash = createHash('sha256').update(bytes).digest('hex');
  const input = new Blob([bytes], { type: 'image/png' });
  const savedBitmap = globalThis.createImageBitmap, savedDocument = globalThis.document;
  try {
    globalThis.createImageBitmap = async blob => { const image = await loadImage(Buffer.from(await blob.arrayBuffer())); image.close = () => {}; return image; };
    globalThis.document = { createElement() {
      const output = createCanvas(1, 1);
      output.toBlob = callback => output.encode('png').then(value => callback(new Blob([value], { type: 'image/png' })));
      return output;
    } };
    const result = await resizeDeliveryBlob(input, { width: 900, height: 1200 });
    const image = await loadImage(Buffer.from(await result.arrayBuffer()));
    assert.equal(image.width, 900); assert.equal(image.height, 1200);
    const check = createCanvas(900, 1200), context = check.getContext('2d'); context.drawImage(image, 0, 0);
    assert.equal(context.getImageData(0, 0, 1, 1).data[3], 0);
    assert.equal(context.getImageData(450, 600, 1, 1).data[3], 255);
    assert.equal(createHash('sha256').update(Buffer.from(await input.arrayBuffer())).digest('hex'), hash);
    if (process.env.GUAN_DELIVERY_EVIDENCE) {
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(process.env.GUAN_DELIVERY_EVIDENCE, { recursive: true });
      await writeFile(process.env.GUAN_DELIVERY_EVIDENCE + '/上游原图1086×1448.png', bytes);
      await writeFile(process.env.GUAN_DELIVERY_EVIDENCE + '/最终交付900×1200.png', Buffer.from(await result.arrayBuffer()));
    }
  } finally { globalThis.createImageBitmap = savedBitmap; globalThis.document = savedDocument; }
});
