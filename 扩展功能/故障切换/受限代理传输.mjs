import { request as httpRequest } from 'node:http';
import { request as httpsRequest, Agent } from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import { lookup } from 'node:dns/promises';
import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } from '../生成网关/生成协议.mjs';
import { publicIPv4 } from '../生成网关/受限请求规划.mjs';
import { 解析代理公网地址 } from '../网络代理/代理域名解析.mjs';

// 生成POST只发送一次。CONNECT失败、超时、未知响应均不会暗中直连或换出口重发。
export async function requestThroughManagedProxy(options) { return proxyRequest(options); }
async function proxyRequest({ url, method, headers, bytes, signal, route, timeout = 600_000, testOrigins = [], testCA, includeHeaders = false, onConnection, onChunk }, resolverAddress) {
  requireValue(url instanceof URL && url.protocol === 'https:' && ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'PROPFIND', 'MKCOL', 'MOVE', 'COPY'].includes(method) && Buffer.isBuffer(bytes) && bytes.length <= MAX_REQUEST_BYTES &&
    Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 600_000 && route?.proxyURL && typeof route.username === 'string' && typeof route.password === 'string' &&
    !/[:\r\n\0]/.test(route.username) && !/[\r\n\0]/.test(route.password), 'proxy_transport_invalid', '受管代理参数无效。');
  const proxy = new URL(route.proxyURL);
  requireValue(proxy.protocol === 'http:' && proxy.hostname === '127.0.0.1' && !!proxy.port && proxy.pathname === '/' && !proxy.username && !proxy.password && !proxy.search && !proxy.hash && !headers['proxy-authorization'], 'proxy_transport_invalid', '只允许本机受管代理。');
  signal?.throwIfAborted();
  // 测试缝仅允许调用方显式提供的临时本机TLS端口；生产装配不传入这两个字段。
  const test = testOrigins.includes(url.origin) && url.hostname === 'localhost';
  const began = Date.now();
  let addresses = resolverAddress ? [{ address: resolverAddress }] : test ? [{ address: '127.0.0.1' }] : await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new StorageError('provider_connection_lost', '代理解析已取消，未发送生成请求。', 502));
    const timer = setTimeout(abort, timeout); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    void lookup(url.hostname, { all: true, family: 4 }).then(value => finish(null, value), () => finish(new StorageError('provider_dns_denied', '代理目标解析失败。', 502)));
  });
  if (!test && !resolverAddress) addresses = await 解析代理公网地址(addresses, () => proxyRequest({
    url: new URL('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(url.hostname) + '&type=A'), method: 'GET',
    headers: { accept: 'application/dns-json', 'accept-encoding': 'identity' }, bytes: Buffer.alloc(0), signal, route,
    timeout: Math.max(1, timeout - (Date.now() - began)),
  }, '1.1.1.1'));
  requireValue(addresses.length && (test || addresses.every(entry => publicIPv4(entry.address))), 'provider_dns_denied', '代理目标必须为已核验公网地址。');
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let done = false, socket, secure, upstream, agent;
    const fail = () => finish(new StorageError('provider_connection_lost', '代理结果未确认，未直连或自动重发。', 502));
    const finish = (error, result) => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      tunnel.destroy(); upstream?.destroy(); secure?.destroy(); socket?.destroy(); agent?.destroy();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => fail();
    const tunnel = httpRequest(proxy, { method: 'CONNECT', path: addresses[0].address + ':' + (url.port || '443'), agent: false,
      headers: { host: addresses[0].address + ':' + (url.port || '443'), 'proxy-authorization': 'Basic ' + Buffer.from(route.username + ':' + route.password).toString('base64') } });
    const timer = setTimeout(fail, Math.max(1, timeout - (Date.now() - began)));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { fail(); return; }
    tunnel.once('error', fail); tunnel.once('response', fail);
    tunnel.once('connect', (response, connected, head) => {
      socket = connected; socket.once('error', fail);
      if (done || response.statusCode !== 200 || head.length) { fail(); return; }
      onConnection?.({ sourcePort: socket.localPort, destinationIP: addresses[0].address });
      secure = tlsConnect({ socket, servername: url.hostname, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'], ...(test && testCA ? { ca: testCA } : {}) });
      secure.once('error', fail);
      secure.once('secureConnect', () => {
        if (done) return;
        agent = new Agent({ keepAlive: false, maxSockets: 1 });
        agent.createConnection = () => secure;
        upstream = httpsRequest(url, { method, headers, agent }, response => {
          const encoding = response.headers['content-encoding'];
          if (response.statusCode >= 300 && response.statusCode < 400 || encoding && encoding !== 'identity') { fail(); return; }
          const chunks = []; let size = 0;
          response.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) { fail(); return; }
            chunks.push(chunk);
            try { onChunk?.({ status: response.statusCode, contentType: String(response.headers['content-type'] || ''), bytes: chunk }); } catch { fail(); }
          });
          response.once('error', fail); response.once('aborted', fail);
          response.once('end', () => finish(null, { status: response.statusCode, contentType: String(response.headers['content-type'] || 'application/octet-stream'), bytes: Buffer.concat(chunks), ...(includeHeaders ? { headers: relayHeaders(response.headers) } : {}) }));
        });
        upstream.once('error', fail); upstream.end(bytes.length ? bytes : undefined);
      });
    });
    tunnel.end();
  });
}
export function relayHeaders(headers) {
  return Object.fromEntries(['content-type', 'etag', 'last-modified', 'content-range', 'accept-ranges', 'dav', 'allow'].filter(name => typeof headers[name] === 'string' && headers[name].length <= 4096 && !/[\r\n\0]/.test(headers[name])).map(name => [name, headers[name]]));
}
