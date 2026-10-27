import { fetch, ProxyAgent } from 'undici';
import { requireValue } from '../本机存储/协议.mjs';

// 仅供固定Smart上游资源检查器调用；不接受浏览器指定下载地址，不带GitHub令牌。
export async function readSmartPublicResource(url, { maxBytes, signal, route, fetchImpl = fetch } = {}) {
  requireValue(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 32 * 1024 ** 2, 'proxy_resource_source_invalid', 'Smart资源读取限制无效。', 503);
  const initial = new URL(url);
  requireValue(initial.protocol === 'https:' && !initial.port && !initial.username && !initial.password && !initial.search && !initial.hash &&
    (initial.hostname === 'api.github.com' && /^\/repos\/vernesong\/mihomo\/releases\/tags\/(?:Prerelease-Alpha|LightGBM-Model)$/.test(initial.pathname) ||
     initial.hostname === 'github.com' && /^\/vernesong\/mihomo\/releases\/download\/(?:Prerelease-Alpha\/mihomo-darwin-arm64-alpha-smart-[a-f0-9]{7,40}\.gz|LightGBM-Model\/Model-large\.bin)$/.test(initial.pathname)),
  'proxy_resource_source_invalid', 'Smart资源必须来自固定官方仓库。', 503);
  let dispatcher;
  if (route) { const proxy = new URL(route.proxyURL); proxy.username = route.username; proxy.password = route.password; dispatcher = new ProxyAgent(proxy.href); }
  try {
    let current = initial;
    for (let hop = 0; hop < 4; hop++) {
      const response = await fetchImpl(current, { redirect: 'manual', credentials: 'omit', signal, headers: { accept: 'application/vnd.github+json, application/octet-stream', 'user-agent': 'GuanWorkbench-SmartUpdater' }, ...(dispatcher ? { dispatcher } : {}) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel(); const next = new URL(location, current);
        requireValue(initial.hostname === 'github.com' && next.protocol === 'https:' && !next.username && !next.password && !next.port && !next.hash &&
          ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname), 'proxy_resource_source_invalid', 'Smart资源跳转来源不匹配。', 503);
        current = next; continue;
      }
      const length = Number(response.headers.get('content-length') || 0);
      if (response.status !== 200 || !Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
        await response.body?.cancel().catch(() => {});
        requireValue(false, 'proxy_resource_download_failed', 'Smart资源下载未完成或超过限制。', 503);
      }
      const chunks = []; let size = 0;
      try { for await (const chunk of response.body) { size += chunk.length; requireValue(size <= maxBytes, 'proxy_resource_download_failed', 'Smart资源超过限制。', 503); chunks.push(Buffer.from(chunk)); } }
      finally { await response.body?.cancel().catch(() => {}); }
      return Buffer.concat(chunks);
    }
    throw Error('proxy_resource_source_invalid');
  } finally { await dispatcher?.destroy().catch(() => {}); }
}
