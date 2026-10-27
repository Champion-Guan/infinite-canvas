import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { preflightImageUpload, attemptImageUpload } from '../扩展功能/媒体交付/图片上传预检.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';

for (const mime of ['image/heic', 'image/heif']) test(`${mime}原文件编码与解码保留类型和完整字节`, async () => {
  const media = new Map();
  const client = {
    async writeMedia(blob) { const id = createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'); media.set(id, blob); return { id }; },
    async readMedia(id) { return media.get(id); },
  };
  const codec = createValueCodec({ client });
  try {
    const file = new Blob([new Uint8Array(6 * 1024 * 1024).fill(37)], { type: mime });
    const encoded = await codec.encode(file), decoded = await codec.decode(encoded.tree);
    assert.equal(decoded.type, mime); assert.equal(decoded.size, file.size);
    assert.deepEqual(Buffer.from(await decoded.arrayBuffer()), Buffer.from(await file.arrayBuffer()));
  } finally { codec.close(); }
});

test('HEIC无法解码时在任何保存调用之前失败，正常PNG仍可继续上传', async () => {
  let writes = 0;
  async function upload(blob, readMetadata) { const meta = await preflightImageUpload(blob, readMetadata); writes++; return meta; }
  await assert.rejects(upload(new Blob(['heic'], { type: 'image/heic' }), async () => { throw Error('decode'); }), /HEIC\/HEIF/);
  assert.equal(writes, 0);
  assert.deepEqual(await upload(new Blob(['png'], { type: 'image/png' }), async () => ({ width: 16, height: 12 })), { width: 16, height: 12 });
  assert.equal(writes, 1);
});

test('拒绝未知图片类型，取消仍保持原AbortError，不进入保存队列', async () => {
  let calls = 0;
  await assert.rejects(preflightImageUpload(new Blob(['svg'], { type: 'image/svg+xml' }), async () => { calls++; return {}; }), /格式暂不支持/);
  assert.equal(calls, 0);
  const aborted = new DOMException('cancelled', 'AbortError');
  await assert.rejects(preflightImageUpload(new Blob(['heic'], { type: 'image/heic' }), async () => { throw aborted; }), error => error === aborted);
});

test('真实解码器返回空值时仍显示HEIC转换说明，入口消费失败并允许随后上传', async () => {
  const notices = [];
  let writes = 0;
  const failed = await attemptImageUpload(async () => {
    await preflightImageUpload(new Blob(['heic'], { type: 'image/heic' }), async () => null);
    writes++;
  }, text => notices.push(text));
  assert.equal(failed, undefined);
  assert.equal(writes, 0);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /HEIC\/HEIF.*JPEG.*其他保存不受影响/);
  const valid = await attemptImageUpload(async () => { writes++; return 'saved'; }, text => notices.push(text));
  assert.equal(valid, 'saved'); assert.equal(writes, 1); assert.equal(notices.length, 1);
  await attemptImageUpload(async () => { throw new DOMException('cancelled', 'AbortError'); }, text => notices.push(text));
  assert.equal(notices.length, 1);
});
