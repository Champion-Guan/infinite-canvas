import { StorageError, requireValue } from './协议.mjs';
import { createCredentialClient } from '../本机凭据/凭据客户端.mjs';
import { createGenerationClient } from '../生成任务/生成任务客户端.mjs';
import { createNetworkProxyClient } from '../网络代理/代理客户端.mjs';
import { createMediaConversionClient } from '../媒体交付/HEIC转换客户端.mjs';

const protocol = 'guan-local-authorization.v1';
function localOrigin(value, data = false) {
  try { const u = new URL(value); return u.origin === value && u.protocol === 'http:' && (data ? u.hostname === '127.0.0.1' : ['localhost', '127.0.0.1'].includes(u.hostname)) && !!u.port; } catch { return false; }
}

// 用户从可信本机入口取得一次性码，在自己的授权表单提交；没有测试注入、Cookie、URL或浏览器持久化。
// 页面刷新后内存授权丢失，须重新从本机入口取得新码；不能静默重新授权。
export async function authorizeLocalStorage({ code, origin = globalThis.location?.origin, fetchImpl = globalThis.fetch, now = Date.now, prepareSession = async () => {} } = {}) {
  requireValue(typeof code === 'string' && /^[0-9a-f]{64}$/.test(code) && localOrigin(origin) && typeof fetchImpl === 'function' && typeof now === 'function', 'invalid_authorization_client', '本机授权码或页面地址无效。');
  requireValue(typeof prepareSession === 'function', 'invalid_session_prepare', '业务入口需要有效的会话准备函数。');
  async function post(path, value, capability, keepalive = false, signal, observe = false) {
    let response, result;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetchImpl(origin + '/__guan-local/' + path, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', keepalive,
          headers: { 'Content-Type': 'application/json', 'X-Guan-Local-Protocol': protocol, ...(path === 'network-proxy' ? { 'X-Guan-Proxy-Protocol': 'guan-network-proxy.v1' } : {}), ...(path === 'generation' ? { 'X-Guan-Generation-Protocol': 'guan-generation.v1' } : {}), ...(capability ? { Authorization: 'Bearer ' + capability } : {}) },
          body: JSON.stringify(value), signal: AbortSignal.any([AbortSignal.timeout(observe ? 660_000 : path === 'network-proxy' ? value.operation === 'relay' ? 610_000 : 180_000 : path === 'software-updates' ? 40_000 : path === 'generation' ? value.operation === 'video-create' ? 610_000 : value.operation === 'video-download' ? 125_000 : ['models', 'video-poll', 'video-terminal'].includes(value.operation) ? 35_000 : 5000 : 5000), ...(signal ? [signal] : [])]) });
        if (observe && response.ok && /^application\/x-ndjson(?:;|$)/i.test(response.headers.get('content-type') || '')) return response;
        result = await response.json();
      } catch { throw new StorageError('authorization_connection_failed', '本机授权响应未确认；不会重发一次性授权码，请从可信入口重新授权。', 503); }
      // 429 是服务端明确表示“本次兑换未执行”，同一张一次性码可以安全地
      // 有界重试。网络中断、5xx 或业务请求绝不在这里自动重发。
      if (path === 'authorize' && response.status === 429 && attempt < 2) {
        const seconds = Number(response.headers.get('retry-after'));
        await new Promise(resolve => setTimeout(resolve, Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0.25), 2) * 1000 : 500));
        continue;
      }
      break;
    }
    requireValue(response.ok && (path === 'credentials' ? result?.format === 'guan-credentials.v1' : path === 'network-proxy' ? result?.protocol === 'guan-network-proxy.v1' : path === 'generation' ? result?.protocol === 'guan-generation.v1' : result?.protocol === protocol) && !result.error,
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
  async function businessCommand(path, value, options) {
    requireValue(!closed && now() < exchange.expiresAt, 'authorization_expired', '页面授权已结束。', 401);
    // 只在发送业务前准备原会话；响应未知时不重放凭据写入、代理操作或收费生成。
    const snapshot = structuredClone(value);
    await prepareSession();
    requireValue(!closed && now() < exchange.expiresAt, 'authorization_expired', '页面授权已结束。', 401);
    options?.signal?.throwIfAborted();
    return post(path, snapshot, capability, false, options?.signal, options?.observe === true);
  }
  async function credentialCommand(value) {
    return businessCommand('credentials', value);
  }
  async function command(value) {
    requireValue(!closed && now() < exchange.expiresAt, 'authorization_expired', '页面授权已结束，不会静默重新授权。', 401);
    return (await post('session', value, capability)).session;
  }
  const generationPort = createGenerationClient({ observe(value, signal) { return businessCommand('generation', value, { signal, observe: true }); }, command(value) {
    return businessCommand('generation', value);
  } });
  return Object.freeze({
    url: exchange.dataURL,
    updatePort: Object.freeze({ async request(operation, input) {
      return (await businessCommand('software-updates', { operation, ...(input === undefined ? {} : operation === 'confirm-no-result' ? { taskId: input.taskId, acknowledgement: input.acknowledgement } : { preferences: input }) })).result;
    } }),
    networkProxyPort: createNetworkProxyClient({ command(value, options) {
      return businessCommand('network-proxy', value, options);
    } }),
    generationPort,
    mediaPort: createMediaConversionClient({ async send(path, blob, { signal, protocol: mediaProtocol }) {
      requireValue(!closed && now() < exchange.expiresAt, 'authorization_expired', '页面授权已结束。', 401);
      await prepareSession();
      signal?.throwIfAborted();
      requireValue(!closed && now() < exchange.expiresAt, 'authorization_expired', '页面授权已结束。', 401);
      return fetchImpl(origin + path, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Guan-Local-Protocol': protocol, 'X-Guan-Media-Protocol': mediaProtocol, Authorization: 'Bearer ' + capability },
        body: blob, signal: AbortSignal.any([AbortSignal.timeout(180_000), ...(signal ? [signal] : [])]) });
    } }),
    secretPort: createCredentialClient({ command: credentialCommand, generationPort }),
    host: Object.freeze({
      initialize: () => command({ operation: 'initialize' }),
      renew: session => command({ operation: 'renew', session: structuredClone(session) }),
      // 复用原页面授权恢复同工作区；不交换新授权码，不延长页面授权期限。
      reconnect: session => command({ operation: 'reconnect', session: structuredClone(session) }),
      async close({ keepalive = false } = {}) {
        if (closed) return;
        // 在发出请求前封住后续操作；卸载请求仅约20字节，仍带原Origin/协议/页面能力校验。
        const currentCapability = capability; closed = true; capability = '';
        if (now() < exchange.expiresAt) await post('session', { operation: 'close' }, currentCapability, keepalive === true);
      },
    }),
  });
}
