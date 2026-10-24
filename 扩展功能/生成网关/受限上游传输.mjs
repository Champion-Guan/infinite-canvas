import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { lookup } from 'node:dns';
import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } from './生成协议.mjs';
import { publicIPv4 } from './受限请求规划.mjs';

// 不使用全局fetch、不跟随重定向、不继承环境代理、Cookie或浏览器请求头。
// HTTPS证书和SNI仍使用原主机名，lookup只提供经核验的地址。
export function requestProviderBytes({ url, method, headers, bytes, signal, timeout = 10 * 60_000, testOrigins = [] }) {
  requireValue(url instanceof URL && ['GET', 'POST'].includes(method) && Buffer.isBuffer(bytes) && bytes.length <= MAX_REQUEST_BYTES &&
    Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 10 * 60_000, 'invalid_provider_transport', '上游传输参数无效。');
  const test = url.protocol === 'http:' && url.hostname === '127.0.0.1' && testOrigins.includes(url.origin);
  requireValue(url.protocol === 'https:' || test, 'provider_transport_denied', '未允许的上游传输。');
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => { if (!settled) { settled = true; clearTimeout(timer); if (error) reject(error); else resolve(result); } };
    const pinnedLookup = (hostname, options, callback) => lookup(hostname, { all: true, family: 4, verbatim: true }, (error, addresses) => {
      if (error || !addresses?.length || addresses.some(item => !publicIPv4(item.address))) return callback(new Error('provider_dns_denied'));
      const entry = addresses[0];
      callback(null, options?.all ? [entry] : entry.address, entry.family);
    });
    const req = (test ? httpRequest : httpsRequest)(url, { method, headers, signal, agent: false, ...(test ? {} : { lookup: pinnedLookup, family: 4 }) }, res => {
      const chunks = []; let size = 0;
      if (res.statusCode >= 300 && res.statusCode < 400) { res.destroy(); finish(new StorageError('provider_redirect_denied', '上游跳转已拒绝，未转发密钥到其他地址。', 502)); return; }
      const encoding = res.headers['content-encoding'];
      if (encoding && encoding !== 'identity') { res.destroy(); finish(new StorageError('provider_encoding_denied', '上游压缩响应不在本批验收范围。', 502)); return; }
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) { res.destroy(); finish(new StorageError('provider_response_too_large', '上游响应超过32MiB，任务待核实，不会自动重发。', 502)); }
        else chunks.push(chunk);
      });
      res.once('error', () => finish(new StorageError('provider_connection_lost', '上游响应未确认，不会自动重发。', 502)));
      res.once('end', () => finish(null, { status: res.statusCode, contentType: String(res.headers['content-type'] || 'application/octet-stream'), bytes: Buffer.concat(chunks) }));
    });
    const timer = setTimeout(() => req.destroy(new Error('provider_timeout')), timeout);
    req.once('error', () => finish(new StorageError('provider_connection_lost', '上游结果未确认，不会自动重发。', 502)));
    req.end(bytes.length ? bytes : undefined);
  });
}
