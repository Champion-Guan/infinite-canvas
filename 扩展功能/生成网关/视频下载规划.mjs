import { requireValue } from '../本机存储/协议.mjs';
import { normalizeEndpoint, planProviderRequest } from './受限请求规划.mjs';

// 仅由原视频账本解析渠道响应后调用；HTTP不接收URL。
// 已知API下载路径使用原绑定认证，其他公网媒体地址不携带渠道认证。
export function planVideoDownload(profile, source, { testOrigins = [] } = {}) {
  requireValue(typeof source === 'string' && source.length > 0 && source.length <= 8192 && !/[\\\x00-\x20]/.test(source) &&
    !/%(?:2e|2f|5c|25|00)/i.test(source.split('?')[0]), 'video_download_denied', '视频下载地址无效。', 502);
  let url; try { url = new URL(source); } catch { /* 下方统一核验 */ }
  requireValue(url && !url.username && !url.password && !url.hash, 'video_download_denied', '视频下载地址无效。', 502);
  normalizeEndpoint(url.origin, { testOrigins }); // DNS在原受限传输实际连接时再次固定。
  const base = new URL(profile.endpoint);
  if (url.origin === base.origin) {
    const prefix = base.pathname.replace(/\/(?:v1|v1beta)\/?$/, '').replace(/\/$/, '');
    const suffix = url.pathname.startsWith(prefix + '/') ? url.pathname.slice(prefix.length) : '';
    const api = profile.kind === 'openai' ? /^\/v1\/videos\/[\w-]+\/content$/.test(suffix)
      : /^\/v1(?:beta)?\/files\/[\w.-]+(?::download)?$/.test(suffix);
    if (api) {
      // Gemini常将key放入下载URI，删除后由后端原绑定请求头认证。
      url.searchParams.delete('key');
      for (const [name, value] of url.searchParams) requireValue(name === 'alt' && value === 'media', 'video_download_denied', '视频下载查询参数不受支持。', 502);
      return { ...planProviderRequest(profile, suffix + url.search, 'GET'), path: suffix + url.search, authenticated: true };
    }
  }
  return { url, headers: { accept: 'video/*, application/octet-stream', 'accept-encoding': 'identity' }, authenticated: false };
}
