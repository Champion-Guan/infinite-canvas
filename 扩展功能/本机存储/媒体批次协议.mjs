import { MAX_MEDIA_BATCH_BYTES, MAX_MEDIA_BATCH_COUNT, MAX_MEDIA_BYTES, MEDIA_TYPES, requireValue } from './协议.mjs';

export const MEDIA_BATCH_CONTENT_TYPE = 'application/x-guan-media-batch';
export const MEDIA_BATCH_BODY_BYTES = MAX_MEDIA_BATCH_BYTES + 6 + MAX_MEDIA_BATCH_COUNT * 264;
const MAGIC = [0x47, 0x4d, 0x42, 0x31];

export function createMediaBatchBody(items) {
  requireValue(Array.isArray(items) && items.length > 0 && items.length <= MAX_MEDIA_BATCH_COUNT, 'invalid_media_batch', '媒体批次数量无效。');
  const parts = [Uint8Array.from([...MAGIC, items.length >> 8, items.length & 0xff])];
  let total = 0;
  for (const item of items) {
    const blob = item?.blob, mime = item?.mime || blob?.type || 'application/octet-stream';
    requireValue(blob instanceof Blob && blob.size > 0 && blob.size <= MAX_MEDIA_BYTES && MEDIA_TYPES.includes(mime), 'invalid_media', '媒体类型或大小不支持。');
    total += blob.size;
    requireValue(total <= MAX_MEDIA_BATCH_BYTES, 'media_batch_too_large', '媒体批次超过临时内存范围。', 413);
    const mimeBytes = new TextEncoder().encode(mime);
    requireValue(mimeBytes.length > 0 && mimeBytes.length <= 255, 'invalid_media_batch', '媒体类型字段长度无效。');
    const sizeBytes = new Uint8Array(8);
    new DataView(sizeBytes.buffer).setBigUint64(0, BigInt(blob.size), false);
    parts.push(Uint8Array.of(mimeBytes.length), mimeBytes, sizeBytes, blob);
  }
  return new Blob(parts, { type: MEDIA_BATCH_CONTENT_TYPE });
}

export function parseMediaBatchBody(bytes) {
  requireValue(bytes instanceof Uint8Array && bytes.byteLength >= 6 && bytes.byteLength <= MEDIA_BATCH_BODY_BYTES,
    'invalid_media_batch', '媒体批次长度无效。');
  requireValue(MAGIC.every((byte, index) => bytes[index] === byte), 'invalid_media_batch', '媒体批次协议版本无效。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, false);
  requireValue(count > 0 && count <= MAX_MEDIA_BATCH_COUNT, 'invalid_media_batch', '媒体批次数量无效。');
  const result = [];
  let offset = 6, total = 0;
  for (let index = 0; index < count; index++) {
    requireValue(offset < bytes.byteLength, 'invalid_media_batch', '媒体批次记录不完整。');
    const mimeLength = bytes[offset++];
    requireValue(mimeLength > 0 && offset + mimeLength + 8 <= bytes.byteLength, 'invalid_media_batch', '媒体批次类型字段不完整。');
    let mime;
    try { mime = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + mimeLength)); }
    catch { requireValue(false, 'invalid_media_batch', '媒体批次类型编码无效。'); }
    offset += mimeLength;
    requireValue(MEDIA_TYPES.includes(mime), 'invalid_media', '媒体类型不支持。');
    const size = view.getBigUint64(offset, false);
    offset += 8;
    requireValue(size > 0n && size <= BigInt(MAX_MEDIA_BYTES) && size <= BigInt(Number.MAX_SAFE_INTEGER), 'invalid_media', '媒体大小无效。');
    const length = Number(size);
    total += length;
    requireValue(total <= MAX_MEDIA_BATCH_BYTES && offset + length <= bytes.byteLength, 'invalid_media_batch', '媒体批次内容不完整或超过临时内存范围。', 413);
    result.push({ bytes: bytes.subarray(offset, offset + length), mime });
    offset += length;
  }
  requireValue(offset === bytes.byteLength, 'invalid_media_batch', '媒体批次包含未识别的尾随数据。');
  return result;
}
