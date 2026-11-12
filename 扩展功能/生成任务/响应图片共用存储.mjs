import { createHash } from 'node:crypto';
import { requireValue, validHash } from '../本机存储/协议.mjs';

export const RESPONSE_IMAGE_ENCODING = 'image-references-v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const format = 'guan-generation-image-references.v1';
function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
}

// 只拆已知图片字段。原始响应的空白、字段顺序及其他文字通过片段原样保留。
export function splitResponseImages(bytes) {
  let parsed;
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) return null;
  try { parsed = JSON.parse(text); } catch { return null; }
  const candidates = new Map();
  function visit(value, parent, key, depth = 0) {
    if (depth > 64) return;
    if (typeof value === 'string' && value.length >= 1024) {
      const data = value.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
      const base64 = data?.[1] || (key === 'b64_json' || key === 'result' && parent?.type === 'image_generation_call' ? value : '');
      if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return;
      const binary = Buffer.from(base64, 'base64'), mime = imageMime(binary);
      if (!mime || binary.toString('base64') !== base64) return;
      candidates.set(JSON.stringify(value), { bytes: binary, mime, prefix: data ? value.slice(0, value.length - base64.length) : '' });
    } else if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) visit(child, value, name, depth + 1);
  }
  visit(parsed, null, '');
  if (!candidates.size) return null;
  const pieces = [], images = [];
  let offset = 0;
  const occurrences = [];
  for (const [token, image] of candidates) {
    let index = text.indexOf(token);
    while (index >= 0) { occurrences.push({ index, length: token.length, image }); index = text.indexOf(token, index + token.length); }
  }
  for (const { index, length, image } of occurrences.sort((a, b) => a.index - b.index)) {
    if (index < offset) continue;
    pieces.push(text.slice(offset, index), { image: images.length, prefix: image.prefix });
    images.push(image);
    offset = index + length;
  }
  if (!images.length || images.length > 256) return null;
  pieces.push(text.slice(offset));
  return { pieces, images, originalHash: sha(bytes), originalSize: bytes.length };
}

export function persistResponseMedia(workspace, bytes) {
  const split = splitResponseImages(bytes);
  if (!split) return workspace.writeMedia(bytes, 'application/octet-stream');
  const images = split.images.map(image => workspace.writeMedia(image.bytes, image.mime));
  const manifest = Buffer.from(JSON.stringify({ format, pieces: split.pieces, images,
    originalHash: split.originalHash, originalSize: split.originalSize }));
  const saved = workspace.writeMedia(manifest, 'application/octet-stream');
  return { ...saved, encoding: RESPONSE_IMAGE_ENCODING, mediaIds: [...new Set(images.map(image => image.id))] };
}

export function responseMediaIds(result) {
  return result ? [result.id, ...(result.mediaIds || [])] : [];
}

export function readResponseMedia(workspace, result) {
  const saved = workspace.readMedia(result.id);
  requireValue(saved.bytes.length === result.size && sha(saved.bytes) === result.id,
    'generation_result_invalid', '任务结果损坏，未交付。', 409);
  if (!result.encoding) return Buffer.from(saved.bytes);
  requireValue(result.encoding === RESPONSE_IMAGE_ENCODING, 'generation_result_invalid', '任务结果格式未知。', 409);
  const manifest = JSON.parse(saved.bytes.toString());
  requireValue(manifest.format === format && Array.isArray(manifest.pieces) && Array.isArray(manifest.images) &&
    validHash(manifest.originalHash) && Number.isSafeInteger(manifest.originalSize) && manifest.originalSize <= 32 * 1024 ** 2 &&
    manifest.images.every(image => validHash(image.id) && result.mediaIds.includes(image.id)),
  'generation_result_invalid', '图片响应引用不完整。', 409);
  const images = manifest.images.map(image => {
    const file = workspace.readMedia(image.id);
    requireValue(file.bytes.length === image.size && sha(file.bytes) === image.id, 'generation_result_invalid', '响应图片校验失败。', 409);
    return file.bytes.toString('base64');
  });
  const bytes = Buffer.from(manifest.pieces.map(piece => typeof piece === 'string' ? piece
    : JSON.stringify(piece.prefix + images[piece.image])).join(''));
  requireValue(bytes.length === manifest.originalSize && sha(bytes) === manifest.originalHash,
    'generation_result_invalid', '响应重组校验失败。', 409);
  return bytes;
}
