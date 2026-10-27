import { isIP } from 'node:net';
import { requireValue } from '../本机存储/协议.mjs';

// 来源：旧项目src/server/secure-provider-proxy.mjs的planSecureProviderRequest。
// 仅迁入OpenAI/Gemini白名单；Agent、WebDAV、GitHub和任意插件不属于生成网关。
const openAIPath = /^\/v1\/(?:models(?:\/[\w.-]+)?|images\/(?:generations|edits|variations)|chat\/completions|responses(?:\/[\w-]+)?|audio\/(?:speech|transcriptions|translations)|videos(?:\/[\w-]+(?:\/content)?)?)$/;
const geminiPath = /^\/v1(?:beta)?\/(?:models(?:\/[\w.:-]+(?:\/operations\/[\w.-]+)?)?|operations\/[\w.-]+|files\/[\w.-]+(?::download)?)$/;
const unsafeCharacters = value => [...value].some(character => character === '\\' || character.charCodeAt(0) <= 0x20);

export function normalizeEndpoint(value, { testOrigins = [] } = {}) {
  requireValue(typeof value === 'string' && value.length <= 4096 && !unsafeCharacters(value), 'invalid_provider_endpoint', '渠道地址格式无效。');
  let url;
  try { url = new URL(value); } catch { requireValue(false, 'invalid_provider_endpoint', '渠道地址格式无效。'); }
  const test = testOrigins.includes(url.origin) && url.hostname === '127.0.0.1' && url.protocol === 'http:';
  requireValue(!url.username && !url.password && !url.search && !url.hash && (url.protocol === 'https:' || test) &&
    !/%(?:2e|2f|5c|25|00)/i.test(value) && !/\/(?:__guan-local|local-secure-api|local-app)(?:\/|$)/.test(url.pathname) &&
    (test || !isIP(url.hostname.replace(/^\[|\]$/g, '')) && url.hostname.includes('.') && !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(url.hostname)),
  'invalid_provider_endpoint', '渠道必须使用公开HTTPS地址，不能带认证信息、查询或本机接口。');
  return url.href.replace(/\/+$/, '');
}

export function planProviderRequest(profile, suffix, method, contentType = '') {
  requireValue(['openai', 'gemini'].includes(profile?.kind) && ['GET', 'POST'].includes(method) && typeof suffix === 'string' && suffix.startsWith('/') && !suffix.startsWith('//') && suffix.length <= 8192 &&
    !unsafeCharacters(suffix) && !/%(?:2e|2f|5c|25|00)/i.test(suffix.split('?')[0]) && !suffix.split('?')[0].split('/').some(part => ['.', '..'].includes(part)),
  'provider_request_denied', '生成请求不在允许路径内。');
  const parsed = new URL('https://request.invalid' + suffix), base = new URL(profile.endpoint);
  requireValue(!parsed.hash && (profile.kind === 'openai' ? openAIPath : geminiPath).test(parsed.pathname), 'provider_request_denied', '生成请求不在允许路径内。');
  for (const [name] of parsed.searchParams) requireValue(['alt', 'pageSize', 'pageToken'].includes(name), 'provider_query_denied', '不接受认证信息或任意渠道查询参数。');
  const allowedMethod = profile.kind === 'openai'
    ? method === 'GET' ? /^\/v1\/(?:models(?:\/[\w.-]+)?|responses\/[\w-]+|videos\/[\w-]+(?:\/content)?)$/.test(parsed.pathname)
      : /^\/v1\/(?:images\/(?:generations|edits|variations)|chat\/completions|responses|audio\/(?:speech|transcriptions|translations)|videos)$/.test(parsed.pathname)
    : method === 'GET' ? /^\/v1(?:beta)?\/(?:models(?:\/[\w.:-]+)?|(?:models\/[\w.:-]+\/)?operations\/[\w.-]+|files\/[\w.-]+(?::download)?)$/.test(parsed.pathname)
      : /^\/v1(?:beta)?\/models\/[\w.:-]+:(?:generateContent|streamGenerateContent|predictLongRunning)$/.test(parsed.pathname);
  requireValue(allowedMethod && (method === 'GET' ? !contentType : !!contentType), 'provider_request_denied', '请求方法与资源操作不匹配。');
  let path = parsed.pathname;
  const version = base.pathname.match(/\/(v1(?:beta)?)$/)?.[1];
  if (version && path.startsWith('/' + version + '/')) path = path.slice(version.length + 1);
  const url = new URL(base.href.replace(/\/+$/, '') + path + parsed.search);
  requireValue(url.origin === base.origin, 'provider_request_denied', '不能覆盖渠道主机。');
  return { url, headers: { accept: 'application/json, application/octet-stream', 'accept-encoding': 'identity', ...(contentType ? { 'content-type': contentType } : {}) } };
}

// DNS结果在实际连接时核验并固定；仅保守允许公网IPv4。IPv6-only渠道明确失败，不降级。
export function publicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
    a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0);
}
