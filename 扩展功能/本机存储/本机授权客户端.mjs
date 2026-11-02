import { StorageError, requireValue } from './协议.mjs';
import { createCredentialClient } from '../本机凭据/凭据客户端.mjs';
import { createGenerationClient } from '../生成任务/生成任务客户端.mjs';
import { createNetworkProxyClient } from '../网络代理/代理客户端.mjs';
import { createMediaConversionClient } from '../媒体交付/HEIC转换客户端.mjs';

const protocol = 'guan-local-authorization.v1';
const requestErrors = Object.freeze({
  generation_http_busy: '本机生成入口暂时繁忙，请稍后查询原任务，不会重复生成。',
  generation_busy: '本机生成任务容量已满，请稍后继续原任务。',
  generation_capacity: '本机生成任务账本已满，未发送新的生成请求。',
  generation_not_found: '本机尚无这笔生成任务，请保留原任务记录。',
  generation_canvas_unconfirmed: '原产品画布保存尚未确认，生成结果仍保留在本机。',
  session_expired: '本机数据会话已过期，请恢复当前会话后继续原任务。',
  session_denied: '本机数据会话暂时不可用，请恢复当前会话后继续原任务。',
  authorization_busy: '本机授权入口暂时繁忙，请稍后重试。',
});
const GENERATION_COMMAND_TIMEOUTS = Object.freeze({
  submit: 30_000,
  get: 30_000,
  list: 30_000,
  checkpoint: 30_000,
  applied: 30_000,
  'retry-save': 60_000,
  result: 120_000,
  cancel: 30_000,
  'route-plan': 30_000,
  bind: 30_000,
  'resolve-saved': 30_000,
  describe: 30_000,
  'credential-preview': 30_000,
  'fallback-load': 30_000,
  'fallback-save': 30_000,
});

/**
 * 生成请求与本机保存是两条不同的等待边界：
 * - 生成入口只负责提交/查询任务，不能因为默认 5 秒的本机等待误报失败；
 * - result/retry-save 可能读取或写入单个媒体，使用更长但仍有限的等待；
 * - 超时只能表示响应未确认，调用方必须复用原任务 ID 查询，不能自动重发。
 */
export function generationCommandTimeout(operation) {
  return GENERATION_COMMAND_TIMEOUTS[operation] || 30_000;
}

function requestTimeout(path, value, observe) {
  if (observe) return 660_000;
  if (path === 'network-proxy') return value?.operation === 'relay' ? 610_000 : 180_000;
  if (path === 'software-updates') return 40_000;
  if (path === 'generation') {
    if (value?.operation === 'video-create') return 610_000;
    if (value?.operation === 'video-download') return 125_000;
    if (['models', 'video-poll', 'video-terminal'].includes(value?.operation)) return 35_000;
    return generationCommandTimeout(value?.operation);
  }
  return 30_000;
}

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
      const timeoutSignal = AbortSignal.timeout(requestTimeout(path, value, observe));
      try {
        response = await fetchImpl(origin + '/__guan-local/' + path, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', keepalive,
          headers: { 'Content-Type': 'application/json', 'X-Guan-Local-Protocol': protocol, ...(path === 'network-proxy' ? { 'X-Guan-Proxy-Protocol': 'guan-network-proxy.v1' } : {}), ...(path === 'generation' ? { 'X-Guan-Generation-Protocol': 'guan-generation.v1' } : {}), ...(capability ? { Authorization: 'Bearer ' + capability } : {}) },
          body: JSON.stringify(value), signal: AbortSignal.any([timeoutSignal, ...(signal ? [signal] : [])]) });
        if (observe && response.ok && /^application\/x-ndjson(?:;|$)/i.test(response.headers.get('content-type') || '')) return response;
        result = await response.json();
      } catch (error) {
        if (signal?.aborted) throw error;
        if (timeoutSignal.aborted) {
          if (path === 'generation') throw new StorageError('request_timeout', '本机生成响应超时；原任务ID已保留，请稍后查询，不会重复生成。', 504);
          throw new StorageError('authorization_connection_failed', '本机授权响应未确认；不会重发一次性授权码，请从可信入口重新授权。', 503);
        }
        if (path === 'generation') throw new StorageError('generation_connection_unknown', '本机生成连接中断；原任务ID已保留，请查询原任务，不要重复生成。', 503);
        throw new StorageError('authorization_connection_failed', '本机授权响应未确认；不会重发一次性授权码，请从可信入口重新授权。', 503);
      }
      // 429 是服务端明确表示“本次兑换未执行”，同一张一次性码可以安全地
      // 有界重试。网络中断、5xx 或业务请求绝不在这里自动重发。
      if (path === 'authorize' && response.status === 429 && attempt < 2) {
        const seconds = Number(response.headers.get('retry-after'));
        await new Promise(resolve => setTimeout(resolve, Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0.25), 2) * 1000 : 500));
        continue;
      }
      break;
    }
    const errorCode = /^[a-z_]{3,64}$/.test(result?.error?.code ?? '') ? result.error.code : path === 'generation' ? 'generation_ack_invalid' : 'authorization_denied';
    const authorizationEnded = ['authorization_denied', 'authorization_expired', 'lease_expired', 'session_host_closed'].includes(errorCode);
    const errorMessage = Object.hasOwn(requestErrors, errorCode) ? requestErrors[errorCode] : (authorizationEnded ? '本机授权已拒绝或结束，请从可信入口重新授权。'
      : path === 'generation' ? '本机生成请求未完成，原任务记录保留，请稍后查询原任务。' : '本机请求未完成，请稍后重试。');
    requireValue(response.ok && (path === 'credentials' ? result?.format === 'guan-credentials.v1' : path === 'network-proxy' ? result?.protocol === 'guan-network-proxy.v1' : path === 'generation' ? result?.protocol === 'guan-generation.v1' : result?.protocol === protocol) && !result.error,
      errorCode, errorMessage, response.status || 503);
    return result;
  }
  const exchange = await post('authorize', { code });
  const time = now();
  requireValue(Number.isSafeInteger(time) && time >= 0 && exchange.origin === origin && localOrigin(exchange.dataURL, true) &&
    /^[0-9a-f]{64}$/.test(exchange.capability) && (exchange.expiresAt === null || Number.isSafeInteger(exchange.expiresAt) && exchange.expiresAt > time && exchange.expiresAt - time <= 8 * 60 * 60_000),
  'invalid_authorization_response', '本机授权返回的地址、期限或能力不匹配。');
  let capability = exchange.capability, closed = false, closeCapability = '', closeFlight = null;
  const pageActive = () => !closed && (exchange.expiresAt === null || now() < exchange.expiresAt);
  exchange.capability = '';
  async function businessCommand(path, value, options) {
    requireValue(pageActive(), 'authorization_expired', '页面授权已结束。', 401);
    // 只在发送业务前准备原会话；响应未知时不重放凭据写入、代理操作或收费生成。
    const snapshot = structuredClone(value);
    await prepareSession();
    requireValue(pageActive(), 'authorization_expired', '页面授权已结束。', 401);
    options?.signal?.throwIfAborted();
    return post(path, snapshot, capability, false, options?.signal, options?.observe === true);
  }
  async function credentialCommand(value) {
    return businessCommand('credentials', value);
  }
  async function command(value) {
    requireValue(pageActive(), 'authorization_expired', '页面授权已结束，不会静默重新授权。', 401);
    return (await post('session', value, capability)).session;
  }
  const generationPort = createGenerationClient({ observe(value, signal) { return businessCommand('generation', value, { signal, observe: true }); }, command(value) {
    return businessCommand('generation', value);
  } });
  return Object.freeze({
    url: exchange.dataURL,
    updatePort: Object.freeze({ async request(operation, input) {
      return (await businessCommand('software-updates', { operation, ...(operation === 'preferences' ? { preferences: input } : operation === 'activity' ? { activity: input } : {}) })).result;
    } }),
    networkProxyPort: createNetworkProxyClient({ command(value, options) {
      return businessCommand('network-proxy', value, options);
    } }),
    generationPort,
    mediaPort: createMediaConversionClient({ async send(path, blob, { signal, protocol: mediaProtocol }) {
      requireValue(pageActive(), 'authorization_expired', '页面授权已结束。', 401);
      await prepareSession();
      signal?.throwIfAborted();
      requireValue(pageActive(), 'authorization_expired', '页面授权已结束。', 401);
      return fetchImpl(origin + path, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Guan-Local-Protocol': protocol, 'X-Guan-Media-Protocol': mediaProtocol, Authorization: 'Bearer ' + capability },
        body: blob, signal: AbortSignal.any([AbortSignal.timeout(180_000), ...(signal ? [signal] : [])]) });
    } }),
    secretPort: createCredentialClient({ command: credentialCommand, generationPort }),
    host: Object.freeze({
      initialize: () => command({ operation: 'initialize' }),
      renew: session => command({ operation: 'renew', session: structuredClone(session) }),
      // 复用原页面授权恢复同工作区；不交换新授权码，不延长页面授权期限。
      reconnect: (session, options = {}) => command({ operation: 'reconnect', session: structuredClone(session), ...(options?.reason ? { reason: options.reason } : {}) }),
      async close({ keepalive = false } = {}) {
        if (!closed) { closeCapability = capability; closed = true; capability = ''; }
        if (closeFlight) return closeFlight;
        if (!closeCapability) return;
        // 先封住业务；释放未确认时仅保留原能力用于重试关闭，不重新授权。
        closeFlight = (async () => {
          try {
            if (exchange.expiresAt === null || now() < exchange.expiresAt)
              await post('session', { operation: 'close' }, closeCapability, keepalive === true);
          } catch (error) {
            // 首次关闭可能已提交但回执丢失；原能力明确撤销也代表关闭完成。
            if (error?.code !== 'authorization_denied' || error.status !== 401) throw error;
          }
          closeCapability = '';
        })().finally(() => { closeFlight = null; });
        return closeFlight;
      },
    }),
  });
}
