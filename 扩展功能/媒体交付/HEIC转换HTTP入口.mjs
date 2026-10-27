import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { HEIC_MAX_BYTES, HEIC_PROTOCOL, HEIC_ROUTE } from './HEIC格式识别.mjs';
import { createHeicConverter } from './HEIC本机转换.mjs';

export function createMediaConversionService({ origin, authorize, converter = createHeicConverter() }) {
  let active = 0, closed = false;
  return Object.freeze({ close: async () => { closed = true; await converter.close(); }, async handle(request, response) {
    if (request.url !== HEIC_ROUTE) return false;
    let counted = false;
    const controller = new AbortController(), abort = () => { if (!response.writableFinished) controller.abort(); };
    response.once('close', abort);
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      requireValue(!closed, 'heic_closed', '工作台正在重启，请稍后重试 HEIC 上传。', 503);
      requireValue(request.headers.host === new URL(origin).host && request.headers.origin === origin && (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin') && request.method === 'POST' && request.headers['content-type'] === 'application/octet-stream' && request.headers['x-guan-media-protocol'] === HEIC_PROTOCOL && request.headers['x-guan-local-protocol'] === 'guan-local-authorization.v1', 'heic_origin_denied', 'HEIC 转换必须来自当前授权工作台。', 403);
      await authorize(request);
      requireValue(active < 4, 'heic_busy', '正在处理多张 HEIC 图片，请稍后再上传。', 503); active++; counted = true;
      const length = request.headers['content-length'];
      requireValue(!length || /^\d+$/.test(length) && Number(length) <= HEIC_MAX_BYTES, 'heic_too_large', 'HEIC/HEIF 图片不能超过 32MB。', 413);
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; requireValue(size <= HEIC_MAX_BYTES, 'heic_too_large', 'HEIC/HEIF 图片不能超过 32MB。', 413); chunks.push(chunk); }
      await authorize(request);
      const result = await converter.convert(Buffer.concat(chunks), { signal: controller.signal });
      await authorize(request);
      if (!response.destroyed) { response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': result.length, 'X-Guan-Media-Protocol': HEIC_PROTOCOL }); response.end(result); }
    } catch (error) {
      if (!response.destroyed && !response.writableEnded) {
        const known = error instanceof StorageError;
        response.writeHead(known ? error.status : 503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ protocol: HEIC_PROTOCOL, error: { code: known ? error.code : 'heic_failed', message: known ? error.message : 'HEIC 转换未完成，请重试。原文件未修改，其他保存不受影响。' } }));
      }
      request.resume();
    } finally { response.removeListener('close', abort); if (counted) active--; }
    return true;
  } });
}
