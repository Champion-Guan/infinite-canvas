import { requestProviderBytes } from '../生成网关/受限上游传输.mjs';
import { requireValue } from '../本机存储/协议.mjs';
import { subscriptionURL, validateSourceText, MAX_PROXY_SOURCE } from './配置边界.mjs';

// 订阅可能携带私密查询参数，只在本机传输；不跟随跳转，不放入日志或业务JSON。
export async function readProxySubscription(value, { signal, requestBytes = requestProviderBytes } = {}) {
  const url = new URL(subscriptionURL(value));
  const reply = await requestBytes({ url, method: 'GET', headers: { accept: 'text/plain, application/yaml', 'accept-encoding': 'identity' }, bytes: Buffer.alloc(0), signal, timeout: 30_000 });
  requireValue(reply.status === 200 && reply.bytes.length <= MAX_PROXY_SOURCE, 'proxy_subscription_failed', '订阅获取失败或超过10MiB。', 502);
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(reply.bytes); } catch { requireValue(false, 'proxy_subscription_failed', '订阅编码无效。', 502); }
  return validateSourceText(text);
}
