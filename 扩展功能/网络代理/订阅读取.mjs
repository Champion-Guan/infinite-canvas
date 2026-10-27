import { requestProviderBytes } from '../生成网关/受限上游传输.mjs';
import { requireValue } from '../本机存储/协议.mjs';
import { subscriptionURL, validateSourceText, MAX_PROXY_SOURCE } from './配置边界.mjs';
import { 内置网络代理订阅 } from './内置订阅设置.mjs';

// 订阅可能携带私密查询参数，只在本机传输；不跟随跳转，不放入日志或业务JSON。
export async function readProxySubscription(value, { signal, fetchImpl = globalThis.fetch } = {}) {
  const url = new URL(subscriptionURL(value));
  let reply;
  if (url.href === 内置网络代理订阅) {
    // 首次启动尚无核心配置。固定用户指定的GitHub地址使用系统网络，兼容系统代理Fake-IP；不允许改目标或跟随跳转。
    const response = await fetchImpl(内置网络代理订阅, { credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { accept: 'text/plain, application/yaml' }, signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]) });
    const length = response.headers.get('content-length');
    if (response.status !== 200 || length && (!/^\d+$/.test(length) || Number(length) > MAX_PROXY_SOURCE)) {
      await response.body?.cancel(); requireValue(false, 'proxy_subscription_failed', '内置订阅获取失败或超过10MiB。', 502);
    }
    requireValue(response.body, 'proxy_subscription_failed', '内置订阅没有正文。', 502);
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
        requireValue(size <= MAX_PROXY_SOURCE, 'proxy_subscription_failed', '内置订阅超过10MiB。', 502); chunks.push(Buffer.from(next.value)); }
      reply = { status: response.status, bytes: Buffer.concat(chunks) };
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } else reply = await requestProviderBytes({ url, method: 'GET', headers: { accept: 'text/plain, application/yaml', 'accept-encoding': 'identity' }, bytes: Buffer.alloc(0), signal, timeout: 30_000 });
  requireValue(reply.status === 200 && reply.bytes.length <= MAX_PROXY_SOURCE, 'proxy_subscription_failed', '订阅获取失败或超过10MiB。', 502);
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(reply.bytes); } catch { requireValue(false, 'proxy_subscription_failed', '订阅编码无效。', 502); }
  return validateSourceText(text);
}
