import { createHash, randomBytes } from 'node:crypto';
import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { CREDENTIAL_FORMAT, validCredentialRef, validCredentialValue } from '../本机凭据/凭据协议.mjs';

export const AUTHORIZATION_PROTOCOL = 'guan-local-authorization.v1';
const prefix = '/__guan-local/';
const digest = value => createHash('sha256').update(value).digest('hex');
const tokenLike = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const exactKeys = (value, keys) => value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).sort().join(',') === keys.sort().join(',');
function localOrigin(value, data = false) {
  try { const u = new URL(value); return u.origin === value && u.protocol === 'http:' && (data ? u.hostname === '127.0.0.1' : ['localhost', '127.0.0.1'].includes(u.hostname)) && !!u.port; } catch { return false; }
}
async function body(request, limit = 4096) {
  const length = request.headers['content-length'];
  requireValue(!length || /^\d+$/.test(length) && Number(length) <= limit, 'body_too_large', '授权请求超过限制。', 413);
  const chunks = []; let size = 0;
  for await (const bytes of request) { size += bytes.length; requireValue(size <= limit, 'body_too_large', '授权请求超过限制。', 413); chunks.push(bytes); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new StorageError('invalid_json', '授权请求格式错误。'); }
}

// 自有HTTP服务器的受限处理器，不监听端口、不启动工作区、不改上游入口。
// 可信本机启动器仅在进程内签发一次性码；不得把码放在URL、日志或Cookie中。
export function createLocalAuthorizationGateway({ origin, dataURL, controller, credentialPort, now = Date.now, ticketTTL = 120_000, pageLifetime = 8 * 60 * 60_000, maxTickets = 4, maxPages = 16, rateLimit = 0 } = {}) {
  requireValue(localOrigin(origin) && localOrigin(dataURL, true) && controller && typeof controller.open === 'function' && (!credentialPort || typeof credentialPort.store === 'function' && typeof credentialPort.read === 'function') && typeof now === 'function' &&
    Number.isSafeInteger(ticketTTL) && ticketTTL > 0 && ticketTTL <= 120_000 && Number.isSafeInteger(pageLifetime) && pageLifetime > 0 && pageLifetime <= 8 * 60 * 60_000 &&
    Number.isSafeInteger(maxTickets) && maxTickets > 0 && maxTickets <= 16 && Number.isSafeInteger(maxPages) && maxPages > 0 && maxPages <= 16 &&
    Number.isSafeInteger(rateLimit) && rateLimit >= 0 && rateLimit <= 120, 'invalid_authorization_config', '本机授权配置无效。');
  const host = new URL(origin).host, tickets = new Map(), pages = new Map();
  let closed = false, active = 0, windowStart = null, count = 0;
  function clock() { const value = now(); requireValue(Number.isSafeInteger(value) && value >= 0, 'invalid_clock', '授权时钟无效。'); return value; }
  function purge(time) {
    for (const [key, value] of tickets) if (value.expiresAt <= time) tickets.delete(key);
    for (const [key, value] of pages) if (value.expiresAt <= time) { value.port.close(); pages.delete(key); }
  }
  function live() { requireValue(!closed, 'authorization_closed', '本机授权入口已关闭。', 503); const time = clock(); purge(time); return time; }
  return Object.freeze({
    issueTicket() {
      const time = live();
      requireValue(tickets.size < maxTickets, 'too_many_tickets', '待使用的本机授权码已达上限。', 429);
      const code = randomBytes(32).toString('hex'), expiresAt = time + ticketTTL;
      tickets.set(digest(code), { expiresAt });
      return Object.freeze({ code, expiresAt, origin, protocol: AUTHORIZATION_PROTOCOL });
    },
    async handle(request, response) {
      if (!request.url?.startsWith(prefix)) return false;
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      response.setHeader('Referrer-Policy', 'no-referrer');
      const json = (status, value) => { if (!response.destroyed && !response.writableEnded) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); } };
      let counted = false;
      try {
        const time = live();
        requireValue(request.headers.host === host && request.headers.origin === origin, 'authorization_origin_denied', '授权请求必须来自当前工作台。', 403);
        requireValue(!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin', 'authorization_origin_denied', '拒绝跨站或跨端口授权请求。', 403);
        requireValue(request.method === 'POST', 'method_denied', '授权入口只接受POST。', 405);
        requireValue(request.headers['content-type'] === 'application/json' && request.headers['x-guan-local-protocol'] === AUTHORIZATION_PROTOCOL, 'authorization_headers_denied', '授权请求头不匹配。', 403);
        requireValue([prefix + 'authorize', prefix + 'session', prefix + 'credentials'].includes(request.url), 'authorization_route_denied', '授权路径不存在。', 404);
        // 只有一次性授权码兑换计入兑换限流。页面会话续期、凭据读取和关闭
        // 属于已授权页面的生命周期操作；它们不能因为刷新或切换设置页签
        // 消耗同一额度，否则 pagehide 无法释放租约，最终会把页面锁死。
        if (request.url === prefix + 'authorize' && rateLimit > 0) {
          if (windowStart === null || time - windowStart >= 60_000) { windowStart = time; count = 0; }
          requireValue(++count <= rateLimit, 'authorization_rate_limited', '授权请求过于频繁，请稍后从本机入口重试。', 429);
        }
        requireValue(active < 4, 'authorization_busy', '授权入口繁忙。', 503); active++; counted = true;
        const value = await body(request, request.url === prefix + 'credentials' ? 16_384 : 4096);
        const currentTime = live(); // 读取慢请求后重新核验期限，不能用请求开始时间兑换过期码。
        if (request.url === prefix + 'authorize') {
          requireValue(exactKeys(value, ['code']) && tokenLike(value.code), 'authorization_denied', '授权码无效、已使用或已过期。', 403);
          const key = digest(value.code), ticket = tickets.get(key);
          requireValue(ticket && ticket.expiresAt > currentTime, 'authorization_denied', '授权码无效、已使用或已过期。', 403);
          requireValue(pages.size < maxPages, 'too_many_pages', '已授权页面数量达到上限。', 429);
          // 在同步打开租约前消费；失败也不让一次性码被再次兑换。
          tickets.delete(key);
          const port = controller.open(), capability = randomBytes(32).toString('hex'), expiresAt = currentTime + pageLifetime;
          pages.set(digest(capability), { port, expiresAt });
          json(200, { protocol: AUTHORIZATION_PROTOCOL, origin, dataURL, capability, expiresAt });
        } else {
          const capability = request.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
          const page = capability && pages.get(digest(capability));
          requireValue(page, 'authorization_denied', '本页面尚未授权或授权已结束。', 401);
          if (request.url === prefix + 'credentials') {
            requireValue(credentialPort, 'credential_unavailable', '本机凭据保管尚未就绪。', 503);
            requireValue(['store', 'inspect'].includes(value?.operation) && exactKeys(value, value.operation === 'store' ? ['operation', 'value'] : ['operation', 'ref']) &&
              (value.operation === 'store' ? validCredentialValue(value.value) : validCredentialRef(value.ref)), 'invalid_credential', '凭据操作格式无效。');
            // 同一页面能力、Origin和活跃数据租约，不能凭旧页面能力绕过休眠过期。
            page.port.initialize();
            let result;
            try {
              if (value.operation === 'store') {
                const ref = await credentialPort.store(value.value);
                requireValue(validCredentialRef(ref), 'credential_ack_invalid', '凭据写入没有有效引用。', 503);
                result = { format: CREDENTIAL_FORMAT, ref };
              } else {
                const saved = await credentialPort.read(value.ref);
                requireValue(validCredentialValue(saved), 'credential_ack_invalid', '凭据读取没有有效内容。', 503);
                result = { format: CREDENTIAL_FORMAT, ref: value.ref };
              }
            } catch { throw new StorageError('credential_unavailable', '本机凭据操作未确认；没有明文降级或替换原配置。', 503); }
            live();
            requireValue(pages.get(digest(capability)) === page, 'authorization_denied', '页面授权已结束。', 401);
            page.port.initialize();
            json(200, result); return true;
          }
          requireValue(['initialize', 'renew', 'reconnect', 'close'].includes(value?.operation) && exactKeys(value, ['renew', 'reconnect'].includes(value.operation) ? ['operation', 'session'] : ['operation']), 'invalid_authorization_command', '会话操作格式无效。');
          let session = null;
          if (value.operation === 'initialize') session = page.port.initialize();
          if (value.operation === 'renew') session = page.port.renew(value.session);
          if (value.operation === 'reconnect') {
            requireValue(typeof page.port.reconnect === 'function', 'reconnect_unavailable', '当前本机服务不支持保留页面重新连接。', 503);
            session = page.port.reconnect(value.session);
          }
          if (value.operation === 'close') { page.port.close(); pages.delete(digest(capability)); }
          json(200, { protocol: AUTHORIZATION_PROTOCOL, session });
        }
      } catch (error) {
        const known = error instanceof StorageError;
        if (known && error.status === 429) response.setHeader('Retry-After', '1');
        json(known ? error.status : 503, { error: { code: known ? error.code : 'authorization_unavailable', message: known ? error.message : '本机授权暂时不可用，没有签发数据访问能力。' } });
        request.resume();
      } finally { if (counted) active--; }
      return true;
    },
    assertGenerationPage(request) {
      live();
      requireValue(request.headers.host === host && request.headers.origin === origin && (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin'), 'authorization_origin_denied', '生成请求必须来自当前工作台。', 403);
      const capability = request.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
      const page = capability && pages.get(digest(capability));
      requireValue(page, 'authorization_denied', '本页面授权已结束。', 401);
      page.port.initialize();
    },
    getStatus() { const time = clock(); purge(time); return { closed, pendingTickets: tickets.size, authorizedPages: pages.size, activeRequests: active }; },
    close() { closed = true; tickets.clear(); for (const page of pages.values()) page.port.close(); pages.clear(); },
  });
}
