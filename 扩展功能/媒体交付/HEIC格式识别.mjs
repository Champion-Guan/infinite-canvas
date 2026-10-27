export const HEIC_MAX_BYTES = 32 * 1024 ** 2;
export const HEIC_PROTOCOL = 'guan-heic-conversion.v1';
export const HEIC_ROUTE = '/__guan-local/convert-heic';

// 只读 ISO-BMFF 的 ftyp，不把 AVIF 或任意同名文件误当成 HEIC。
/** @param {Uint8Array} bytes */
export function heicMime(bytes) {
  const word = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 16 || word(4) !== 'ftyp') return '';
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size < 16 || size > bytes.length || size > 4096) return '';
  const brands = [word(8)];
  for (let offset = 16; offset + 4 <= size; offset += 4) brands.push(word(offset));
  if (brands.some(brand => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'].includes(brand))) return 'image/heic';
  return brands.includes('mif1') && !brands.some(brand => ['avif', 'avis'].includes(brand)) ? 'image/heif' : '';
}

/** @param {Blob & {name?: string}} blob */
export function hasHeicNameOrType(blob) {
  return /^image\/hei[cf](?:-sequence)?$/i.test(blob.type) || /\.hei[cf]$/i.test(blob.name || '');
}

/** @param {Blob & {name?: string}} blob */
export async function identifyHeic(blob) {
  const named = hasHeicNameOrType(blob);
  const mime = heicMime(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()));
  if (named && !mime) throw new Error('HEIC/HEIF 文件内容不完整或格式不正确，请重新选择原文件。');
  if (mime && blob.size > HEIC_MAX_BYTES) throw new Error('HEIC/HEIF 图片不能超过 32MB。');
  return mime;
}
