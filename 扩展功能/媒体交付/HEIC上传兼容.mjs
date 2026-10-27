import { identifyHeic } from './HEIC格式识别.mjs';

// 所有上传/粘贴/远程图片共用此入口；即使 Safari 能解码，也使用模型可接受的交付格式。
/** @param {Blob} blob @param {{signal?: AbortSignal, host?: {convertHeic(blob: Blob, options?: {signal?: AbortSignal}): Promise<Blob>}}} options */
export async function prepareCompatibleImage(blob, { signal, host = globalThis.window?.__guanMediaHost } = {}) {
  signal?.throwIfAborted();
  const mime = await identifyHeic(blob);
  signal?.throwIfAborted();
  if (!mime) return { original: blob, delivery: blob };
  if (typeof host?.convertHeic !== 'function') throw new Error('本机 HEIC 转换服务尚未就绪，请重启工作台后重试。原文件未修改。');
  const original = blob.type === mime ? blob : new Blob([blob], { type: mime });
  const delivery = await host.convertHeic(original, { signal });
  signal?.throwIfAborted();
  return { original, delivery };
}
