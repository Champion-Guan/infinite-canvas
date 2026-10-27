import { StorageError, requireValue } from './协议.mjs';
import { createCredentialClient } from '../本机凭据/凭据客户端.mjs';

const protocol = 'guan-local-authorization.v1';
function localOrigin(value, data = false) {
  try { const u = new URL(value); return u.origin === value && u.protocol === 'http:' && (data ? u.hostname === '127.0.0.1' : ['localhost', '127.0.0.1'].includes(u.hostname)) && !!u.port; } catch { return false; }
}

// 用户从可信本机入口取得一次性码，在自己的授权表单提交；没有测试注入、Cookie、URL或浏览器持久化。
// 页面刷新后内存授权丢失，须重新从本机入口取得新码；不能静默重新授权。
export async function authorizeLocalStorage({ code, origin = globalThis.location?.origin, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  requireValue(typeof code === 'string' && /^[0-9a-f]{64}$/.test(code) && localOrigin(origin) && typeof fetchImpl === 'function' && typeof now === 'function', 'invalid_authorization_client', '本机授权码或页面地址无效。');
  async function post(path, value, capability) {
    let response, result;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetchImpl(origin + '/__guan-local/' + path, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/json', 'X-Guan-Local-Protocol': protocol, ...(capability ? { Authorization: 'Bearer ' + capability } : {}) },
          body: JSON.stringify(value), signal: AbortSignal.timeout(5000) });
        result = await response.json();
      } catch { throw new StorageError('authorization_connection_failed', '本机授权响应未确认；不会重发一次性授权码，请从可信入口重新授权。', 503); }
      if (path === 'authorize' && response.status === 429 && attempt < 2) {
        const seconds = Number(response.headers.get('retry-after'));
        await new Promise(resolve => setTimeout(resolve, Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0.25), 2) * 1000 : 500));
        continue;
      }
      break;
    }
    requireValue(response.ok && (path === 'credentials' ? result?.format === 'guan-credentials.v1' : result?.protocol === protocol) && !result.error,
      /^[a-z_]{3,64}$/.test(result?.error?.code ?? '') ? result.error.code : 'authorization_denied', '本机授权已拒绝或结束，请从可信入口重新授权。', response.status || 503);
    return result;
  }
  const exchange = await post('authorize', { code });
  const time = now();
  requireValue(Number.isSafeInteger(time) && time >= 0 && exchange.origin === origin && localOrigin(exchange.dataURL, true) &&
    /^[0-9a-f]{64}$/.test(exchange.capability) && Number.isSafeInteger(exchange.expiresAt) && exchange.expiresAt > time && exchange.expiresAt - time <= 8 * 60 * 60_000,
  'invalid_authorization_response', '本机授权返回的地址、期限或能力不匹配。');
  let capability = exchange.capability, closed = false;
  exchange.capability = '';
  async function credentialCommand(value) {
    requireValue(!closed && now() < exchange.expiresAt, 'authorization_expired', '页面授权已结束，不会静默重新授权。', 401);
    return post('credentials', value, capability);
  }
  async function command(value) {
    requireValue(!closed && now() < exchange.expiresAt, 'authorization_expired', '页面授权已结束，不会静默重新授权。', 401);
    return (await post('session', value, capability)).session;
  }
  return Object.freeze({
    url: exchange.dataURL,
    secretPort: createCredentialClient({ command: credentialCommand }),
    host: Object.freeze({
      initialize: () => command({ operation: 'initialize' }),
      renew: session => command({ operation: 'renew', session: structuredClone(session) }),
      // 不由定时器或业务请求触发；仅交给明确的“重新连接并保存”流程。
      reconnect: session => command({ operation: 'reconnect', session: structuredClone(session) }),
      async close() { if (closed) return; try { await command({ operation: 'close' }); } finally { closed = true; capability = ''; } },
    }),
  });
}
