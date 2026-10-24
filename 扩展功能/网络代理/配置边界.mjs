import { parseDocument, stringify, visit } from 'yaml';
import { buildMihomoConfig } from './旧版配置转换.mjs';
import { requireValue } from '../本机存储/协议.mjs';

export const PROXY_PROTOCOL = 'guan-network-proxy.v1';
export const MAX_PROXY_SOURCE = 10 * 1024 * 1024;
export const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function subscriptionURL(value) {
  requireValue(typeof value === 'string' && value.length <= 4096 && !/[\s\\\0]/.test(value), 'proxy_subscription_invalid', '订阅须为公开HTTPS地址。');
  let url; try { url = new URL(value); } catch { requireValue(false, 'proxy_subscription_invalid', '订阅地址格式无效。'); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
    /^[a-z0-9.-]+$/i.test(url.hostname) && url.hostname.includes('.') && !/^(?:\d+\.){3}\d+$/.test(url.hostname) &&
    !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname), 'proxy_subscription_invalid', '订阅须为公开HTTPS地址。');
  return url.href;
}
export function validateSourceText(value) {
  requireValue(typeof value === 'string' && value.isWellFormed() && value.trim() && Buffer.byteLength(value) <= MAX_PROXY_SOURCE,
    'proxy_source_invalid', '代理配置为空、编码无效或超过10MiB。');
  return value;
}

// 沿用旧版SS/Hysteria2、Base64订阅和内联Clash/Mihomo转换；不继承环境文件和其他应用配置。
export function buildIsolatedProxyConfig(source, { port, controllerToken, proxyPassword }) {
  validateSourceText(source);
  requireValue(Number.isInteger(port) && port >= 1024 && port < 65535 && /^[a-f0-9]{64}$/.test(controllerToken) && /^[a-f0-9]{64}$/.test(proxyPassword),
    'proxy_runtime_invalid', '代理运行参数无效。');
  let value;
  try {
    const document = parseDocument(buildMihomoConfig(source, port), { uniqueKeys: true, strict: true, schema: 'core' });
    requireValue(document.errors.length === 0 && document.warnings.length === 0, 'proxy_yaml_invalid', '代理配置格式无效。');
    visit(document, { Alias() { throw new Error('proxy_alias_denied'); } });
    value = document.toJS({ maxAliasCount: 0 });
  } catch { requireValue(false, 'proxy_yaml_invalid', '代理配置格式无效；不接受别名或自定义标签。'); }
  requireValue(value && Object.getPrototypeOf(value) === Object.prototype &&
    !value['proxy-providers'] && !value['rule-providers'] && !value.script && !value.listeners,
  'proxy_external_config_denied', '请上传包含内联节点的完整配置；外部提供器、脚本及自定义监听器暂不接入。');
  requireValue(Array.isArray(value.proxies) && value.proxies.length > 0 && value.proxies.length <= 2048 &&
    value.proxies.every(node => node && ['ss', 'hysteria2', 'vmess', 'vless', 'trojan', 'http', 'socks5', 'tuic', 'hysteria'].includes(node.type) &&
      typeof node.name === 'string' && node.name.length > 0 && node.name.length <= 256 && !/[\r\n\0]/.test(node.name) &&
      typeof node.server === 'string' && node.server.length <= 256 && Number.isInteger(node.port) && node.port > 0 && node.port <= 65535),
  'proxy_nodes_invalid', '代理节点类型、数量或连接参数无效。');
  requireValue(new Set(value.proxies.map(node => node.name)).size === value.proxies.length, 'proxy_nodes_invalid', '代理节点名称不能重复。');
  const retained = {};
  for (const key of ['proxies', 'proxy-groups', 'rules', 'mode', 'ipv6', 'tcp-concurrent', 'unified-delay']) if (Object.hasOwn(value, key)) retained[key] = value[key];
  return stringify({ ...retained, 'mixed-port': port, port: 0, 'socks-port': 0, 'redir-port': 0, 'tproxy-port': 0,
    'bind-address': '127.0.0.1', 'allow-lan': false, authentication: ['workbench:' + proxyPassword], 'skip-auth-prefixes': [],
    'external-controller': '127.0.0.1:' + (port + 1), secret: controllerToken,
    'external-controller-unix': '', 'external-controller-pipe': '', 'external-ui': '', 'external-ui-url': '',
    tun: { enable: false }, dns: { enable: false }, sniffer: { enable: false }, 'log-level': 'silent',
    profile: { 'store-selected': false, 'store-fake-ip': false },
  });
}
