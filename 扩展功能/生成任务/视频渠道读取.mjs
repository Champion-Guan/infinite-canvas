import { createHash } from 'node:crypto';
import { requireValue } from '../本机存储/协议.mjs';

// 所有路径与身份均来自落盘的原任务，页面不能提供远端ID、下载地址或新渠道。
export async function readRemoteVideoState(gateway, job) {
  const version = new URL(gateway.describe(job.binding).endpoint).pathname.endsWith('/v1') ? 'v1' : 'v1beta';
  const path = job.provider === 'gemini' ? `/${version}/` + job.remoteId : '/v1/videos/' + job.remoteId;
  const response = await gateway.execute(job.binding, { method: 'GET', path, contentType: '', body: '' }, { timeout: 30000 });
  requireValue(response.status >= 200 && response.status < 300 && /json/i.test(response.contentType) && response.bytes.length <= 1024 * 1024,
    'video_check_unconfirmed', '渠道未返回有效状态，保留原视频任务。', 409);
  let state; try { state = JSON.parse(response.bytes.toString('utf8')); } catch { /* 下方统一核验 */ }
  requireValue(state && (state.code === undefined || [0, 200, '0', '200'].includes(state.code)), 'video_check_unconfirmed', '渠道查询失败，保留原视频任务。', 409);
  if (state?.data && typeof state.data === 'object') {
    state = state.data;
  }
  requireValue(state && typeof state === 'object' && !Array.isArray(state) && (job.provider === 'openai' ? state.id === job.remoteId : state.name === job.remoteId),
    'video_check_mismatch', '渠道响应与原视频任务不符。', 409);
  const failed = job.provider === 'openai' ? ['failed', 'cancelled'].includes(state.status) : !!state.error && state.done === true;
  const completed = job.provider === 'openai' ? state.status === 'completed' : state.done === true && !state.error;
  return { status: failed ? 'failed' : completed ? 'completed' : 'pending', state };
}
export async function downloadRemoteVideo(gateway, job, state) {
  const url = job.provider === 'gemini' ? state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
    : [state.video_url, state.result_url, state.url, state.content?.video_url, state.content?.url].find(value => typeof value === 'string' && value);
  let result;
  if (url) result = await gateway.downloadVideo(job.binding, url);
  else {
    requireValue(job.provider === 'openai', 'video_media_missing', '渠道尚未提供视频文件，保留原任务，请勿重新生成。', 409);
    result = await gateway.execute(job.binding, { method: 'GET', path: '/v1/videos/' + job.remoteId + '/content', contentType: '', body: '' }, { timeout: 120000 });
  }
  const mime = result.contentType.split(';')[0].trim().toLowerCase(), bytes = result.bytes;
  requireValue(result.status >= 200 && result.status < 300 && ['video/mp4', 'video/webm', 'video/quicktime', 'application/octet-stream'].includes(mime) && bytes.length > 0,
    'video_media_invalid', '渠道未返回可用视频文件，保留原任务，请勿重新生成。', 502);
  const mp4 = bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp', webm = bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3;
  requireValue((mime === 'video/webm' ? webm : mime === 'application/octet-stream' ? mp4 || webm : mp4), 'video_media_invalid', '视频文件内容与类型不符，未标记成功。', 502);
  return { contentType: mime === 'application/octet-stream' ? webm ? 'video/webm' : 'video/mp4' : mime,
    bytes: bytes.toString('base64'), size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') };
}
