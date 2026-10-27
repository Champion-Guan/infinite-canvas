import { HEIC_MAX_BYTES, HEIC_PROTOCOL, HEIC_ROUTE } from './HEIC格式识别.mjs';

export function createMediaConversionClient({ send }) {
  return Object.freeze({ async convertHeic(blob, { signal } = {}) {
    signal?.throwIfAborted();
    if (!(blob instanceof Blob) || !blob.size || blob.size > HEIC_MAX_BYTES) throw new Error('HEIC/HEIF 图片不能为空或超过 32MB。');
    let response;
    try { response = await send(HEIC_ROUTE, blob, { signal, protocol: HEIC_PROTOCOL }); }
    catch (error) {
      signal?.throwIfAborted();
      if (error?.name === 'TimeoutError') throw new Error('HEIC 图片转换超时，请重试。原文件未修改。');
      throw new Error('本机 HEIC 转换未完成，请重试。原文件未修改。');
    }
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      const known = result?.protocol === HEIC_PROTOCOL && typeof result?.error?.message === 'string';
      throw new Error(known ? result.error.message : 'HEIC 图片转换失败，请重试。原文件未修改。');
    }
    const length = Number(response.headers.get('content-length'));
    if (response.headers.get('x-guan-media-protocol') !== HEIC_PROTOCOL || response.headers.get('content-type') !== 'image/jpeg' || !length || length > HEIC_MAX_BYTES) throw new Error('HEIC 转换结果不完整，请重试。');
    const result = await response.blob();
    signal?.throwIfAborted();
    if (result.size !== length || result.size > HEIC_MAX_BYTES) throw new Error('HEIC 转换结果不完整，请重试。');
    return result;
  } });
}
