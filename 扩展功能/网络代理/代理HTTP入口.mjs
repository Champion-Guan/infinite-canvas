import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { PROXY_PROTOCOL, MAX_PROXY_SOURCE, exact } from './配置边界.mjs';

export function createNetworkProxyHTTPHandler({ origin, authorize, proxy, now = Date.now } = {}) {
  requireValue(/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin) && typeof authorize === 'function' && typeof proxy?.status === 'function', 'proxy_http_invalid', '代理入口必须使用当前工作台授权。');
  let active = 0, count = 0, windowStart = now();
  return async function handle(request, response) {
    if (request.url !== '/__guan-local/network-proxy') return false;
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    const json = (status, value) => { if (!response.destroyed && !response.writableEnded) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ protocol: PROXY_PROTOCOL, ...value })); } };
    let counted = false;
    try {
      requireValue(request.headers.host === new URL(origin).host && request.headers.origin === origin && (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin') &&
        request.method === 'POST' && request.headers['content-type'] === 'application/json' && request.headers['x-guan-proxy-protocol'] === PROXY_PROTOCOL,
      'proxy_origin_denied', '代理请求必须来自当前授权工作台。', 403);
      await authorize(request);
      const time = now(); if (time - windowStart >= 60_000) { count = 0; windowStart = time; }
      requireValue(++count <= 60 && active < 2, 'proxy_http_busy', '代理入口繁忙。', 429); active++; counted = true;
      const limit = MAX_PROXY_SOURCE * 6 + 16384, length = request.headers['content-length'];
      requireValue(!length || /^\d+$/.test(length) && Number(length) <= limit, 'proxy_body_large', '代理请求过大。', 413);
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; requireValue(size <= limit, 'proxy_body_large', '代理请求过大。', 413); chunks.push(chunk); }
      let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw new StorageError('proxy_json_invalid', '代理请求格式无效。'); }
      await authorize(request);
      let result;
      if (exact(value, ['operation']) && value.operation === 'status') result = proxy.status();
      else if (exact(value, ['operation', 'configText', 'subscriptionUrl', 'fileName']) && value.operation === 'configure') result = await proxy.configure(value);
      else if (exact(value, ['operation', 'enabled']) && value.operation === 'toggle') result = await proxy.toggle(value.enabled);
      else if (exact(value, ['operation']) && value.operation === 'refresh') result = await proxy.refresh();
      else if (exact(value, ['operation']) && value.operation === 'nodes') result = await proxy.nodes();
      else if (exact(value, ['operation']) && value.operation === 'diagnose') result = await proxy.diagnose();
      else if (exact(value, ['operation', 'group', 'name']) && value.operation === 'select' && typeof value.group === 'string' && typeof value.name === 'string' && value.group.length <= 256 && value.name.length <= 256) result = await proxy.select(value.group, value.name);
      else requireValue(false, 'proxy_command_denied', '代理操作不受支持。');
      await authorize(request); json(200, { result });
    } catch (error) { json(error instanceof StorageError ? error.status : 503, { error: { code: error instanceof StorageError ? error.code : 'proxy_unavailable', message: '代理操作未确认，配置保留；请检查状态，不要反复提交。' } }); request.resume(); }
    finally { if (counted) active--; }
    return true;
  };
}
