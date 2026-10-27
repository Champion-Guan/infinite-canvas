import { MEDIA_TYPES } from '../本机存储/协议.mjs';

// 浏览器解码和类型检查先于持久化队列；不让一次不支持的上传卡住其他保存。
/** @template T @param {Blob} blob @param {() => Promise<T>} readMetadata @returns {Promise<NonNullable<T>>} */
export async function preflightImageUpload(blob, readMetadata) {
  if (!(blob instanceof Blob) || !blob.size || blob.type && !MEDIA_TYPES.includes(blob.type)) {
    throw new Error('此图片格式暂不支持，请先转换为 PNG、JPEG 或 WebP 后上传。');
  }
  let metadata;
  try {
    metadata = await readMetadata();
    if (!metadata) throw new Error('无法读取图片，请确认图片完整后重试。');
  }
  catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (/^image\/hei[cf]$/i.test(blob.type)) {
      throw new Error('当前浏览器无法读取 HEIC/HEIF 图片，请转换为 JPEG 或 PNG 后上传。原文件未修改，其他保存不受影响。');
    }
    throw error;
  }
  return metadata;
}

/** @template T @param {() => Promise<T>} upload @param {(message: string) => unknown} notify */
export async function attemptImageUpload(upload, notify) {
  try { return await upload(); }
  catch (error) {
    if (error?.name !== 'AbortError') notify(error instanceof Error ? error.message : '图片上传失败，请重试。');
  }
}
