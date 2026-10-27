import { isIP } from 'node:net';
import { requireValue } from '../本机存储/协议.mjs';
import { requestProviderBytes } from '../生成网关/受限上游传输.mjs';
import { requestThroughManagedProxy } from '../故障切换/受限代理传输.mjs';
import { MAX_REQUEST_BYTES } from '../生成网关/生成协议.mjs';

const methods = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'PROPFIND', 'MKCOL', 'MOVE', 'COPY'];
const headerNames = new Set(['authorization', 'x-goog-api-key', 'content-type', 'accept', 'openai-organization', 'openai-project', 'depth', 'destination', 'overwrite', 'if-match', 'if-none-match', 'range']);
export function 检查转发目标(value) {
  let url; try { url = new URL(value); } catch { requireValue(false, 'relay_target_invalid', '请求地址无效。'); }
  requireValue(typeof value === 'string' && value.length <= 16384 && url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
    !isIP(url.hostname.replace(/^\[|\]$/g, '')) && url.hostname.includes('.') && !/(?:^|\.)(localhost|local|internal|invalid|test)$/.test(url.hostname) && !/[\r\n\0\\]/.test(value),
    'relay_target_invalid', '本地转发仅支持公开HTTPS地址。');
  return url;
}
export function 创建本地转发({ proxy, direct = requestProviderBytes, proxied = requestThroughManagedProxy }) {
  return async function relay(value, { signal } = {}) {
    requireValue(proxy.status().relayEnabled, 'relay_disabled', '本地代理已关闭。', 409);
    requireValue(value && Object.keys(value).sort().join(',') === 'body,headers,method,url' && methods.includes(value.method) && typeof value.body === 'string' &&
      value.body.length <= Math.ceil(MAX_REQUEST_BYTES / 3) * 4 && value.body.length % 4 === 0 && value.headers && Object.getPrototypeOf(value.headers) === Object.prototype,
      'relay_request_invalid', '本地转发请求格式无效。');
    const url = 检查转发目标(value.url), headers = { 'accept-encoding': 'identity' }, secrets = [];
    for (const [name, content] of Object.entries(value.headers)) {
      requireValue(headerNames.has(name) && typeof content === 'string' && content.length <= 16384 && !/[\r\n\0]/.test(content), 'relay_header_invalid', '转发请求头无效。');
      if (name === 'destination') requireValue(检查转发目标(content).origin === url.origin, 'relay_target_invalid', 'WebDAV移动和复制须在同一服务内。');
      headers[name] = content;
      if (['authorization', 'x-goog-api-key'].includes(name)) secrets.push(content, content.replace(/^(?:Bearer|Basic) /i, ''));
    }
    const bytes = Buffer.from(value.body, 'base64');
    requireValue(bytes.length <= MAX_REQUEST_BYTES && bytes.toString('base64') === value.body && (!['GET', 'HEAD'].includes(value.method) || !bytes.length), 'relay_request_invalid', '转发正文超限或方法无效。');
    const state = proxy.status(), lease = proxy.acquireRoute(state.enabled ? 'proxy' : 'direct');
    try {
      const result = await (state.enabled ? proxied : direct)({ url, method: value.method, headers, bytes, route: lease, signal, includeHeaders: true });
      // 请求携带的认证不回显到页面日志或错误内容。
      if (/(?:json|text|xml|event-stream)/i.test(result.contentType) && secrets.length) {
        let text = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes);
        for (const secret of secrets.filter(Boolean)) for (const variant of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])) text = text.split(variant).join('[credential-redacted]');
        result.bytes = Buffer.from(text);
      }
      const responseHeaders = result.headers || { 'content-type': result.contentType };
      for (const name of Object.keys(responseHeaders)) if (secrets.some(secret => secret && responseHeaders[name].includes(secret))) delete responseHeaders[name];
      return { status: result.status, headers: responseHeaders, body: result.bytes.toString('base64') };
    } finally { lease.release(); }
  };
}
