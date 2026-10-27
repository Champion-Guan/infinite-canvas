import { requireValue, validHash } from '../本机存储/协议.mjs';
import { canonicalBase64, MAX_RESPONSE_BYTES } from '../生成网关/生成协议.mjs';

const match = (reply, record) => {
  requireValue(reply && ['id', 'productId', 'nodeId', 'remoteId'].every(key => reply[key] === record[key]) && ['pending', 'completed', 'failed'].includes(reply.status),
    'video_scope_mismatch', '视频响应与原产品、节点或任务不符，未写入画布。', 409);
  return reply;
};
const pause = (ms, signal) => new Promise((resolve, reject) => {
  const finish = error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
  const abort = () => finish(signal.reason || new DOMException('Aborted', 'AbortError'));
  const timer = setTimeout(() => finish(), ms);
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
});

export async function waitForProtectedVideo({ host, record, signal, interval = 2500, attempts = 120 }) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted();
    const reply = match(await host.videoPoll(record.id), record); signal?.throwIfAborted();
    if (reply.status === 'failed') throw Object.assign(Error('渠道视频生成失败，原任务记录保留。'), { name: 'VideoTaskFailed' });
    if (reply.status === 'completed') {
      const result = match(await host.videoDownload(record.id), record); signal?.throwIfAborted();
      const media = result.media;
      requireValue(result.status === 'completed' && media && ['video/mp4', 'video/webm', 'video/quicktime'].includes(media.contentType) && validHash(media.hash) &&
        Number.isSafeInteger(media.size) && media.size > 0 && media.size <= MAX_RESPONSE_BYTES && canonicalBase64(media.bytes, MAX_RESPONSE_BYTES),
        'video_media_invalid', '视频文件响应无效，保留原任务，请勿重新生成。', 502);
      const bytes = Uint8Array.from(atob(media.bytes), value => value.charCodeAt(0));
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      requireValue(bytes.length === media.size && hash === media.hash, 'video_media_invalid', '视频文件大小或摘要不符，未标记成功。', 502);
      signal?.throwIfAborted(); return { blob: new Blob([bytes], { type: media.contentType }) };
    }
    if (attempt + 1 < attempts) await pause(interval, signal);
  }
  throw Error('视频仍未完成，原任务ID已保留，请稍后继续查询。');
}
