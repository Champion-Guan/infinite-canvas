import { requireValue } from '../本机存储/协议.mjs';
import { validCredentialRef } from './凭据协议.mjs';
import { isMaskedCredential } from './密钥脱敏.mjs';

export const isChannelBinding = value => typeof value === 'string' && /^provider:[a-f0-9]{64}$/.test(value);
export const isSealedCredential = value => typeof value === 'string' && value.startsWith('guan-vault:') && validCredentialRef(value.slice(11));
export const isProtectedCredential = value => isChannelBinding(value) || isSealedCredential(value);
export const sealedCredentialRef = value => isSealedCredential(value) ? value.slice(11) : null;
export function comparableEndpoint(value) {
  try { return new URL(value).href.replace(/\/+$/, ''); } catch { return value; }
}
const flights = new WeakMap();
// 已保存凭据只能复用不可变渠道绑定；不允许将secret引用重新绑定其他地址。
export async function bindChannelConfiguration(host, channel) {
  requireValue(host?.bind && host?.describe && typeof channel?.apiKey === 'string' && channel.apiKey.trim(), 'channel_credential_required', '请填写渠道密钥。');
  if (isChannelBinding(channel.apiKey)) {
    const saved = await host.describe(channel.apiKey);
    requireValue(saved.binding === channel.apiKey && saved.kind === channel.apiFormat && comparableEndpoint(saved.endpoint) === comparableEndpoint(channel.baseUrl),
      'channel_credential_scope_changed', '渠道地址或协议已改变，请重新输入密钥；原凭据仍保留。', 409);
    return channel.apiKey;
  }
  requireValue(!/^(?:provider:|secret:|guan-vault:)/i.test(channel.apiKey), 'channel_credential_unbound', '旧凭据已保留，请为当前渠道重新输入有效密钥。', 409);
  requireValue(!isMaskedCredential(channel.apiKey), 'channel_credential_masked', '这是脱敏核对信息，请填写完整密钥；原凭据仍保留。', 409);
  const profile = { kind: channel.apiFormat, endpoint: channel.baseUrl, value: channel.apiKey };
  const bytes = new TextEncoder().encode(JSON.stringify(profile));
  const key = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  let cache = flights.get(host);
  if (!cache) { cache = new Map(); flights.set(host, cache); }
  if (!cache.has(key)) {
    const flight = host.bind(profile).then(result => { requireValue(isChannelBinding(result?.binding), 'channel_binding_invalid', '渠道绑定保存尚未确认。', 503); return result.binding; });
    cache.set(key, flight); if (cache.size > 64) cache.delete(cache.keys().next().value);
    void flight.catch(() => { if (cache.get(key) === flight) cache.delete(key); });
  }
  return cache.get(key);
}
