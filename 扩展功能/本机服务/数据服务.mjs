import { createServer } from 'node:http';
import { createWriteCoordinator } from './写入协调.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { COLLECTIONS, MAX_DOCUMENT_BYTES, MAX_MEDIA_BYTES, PROTOCOL, StorageError, requireValue, validHash, validId, validUUID } from '../本机存储/协议.mjs';
import { readNamespaceSnapshot } from '../本机存储/命名空间快照.mjs';

const MAX_JSON_BODY = MAX_DOCUMENT_BYTES + 64 * 1024;
const ALLOWED_HEADERS = ['authorization', 'content-type', 'x-guan-csrf'];
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function validOrigin(origin) {
  try { const url = new URL(origin); return url.origin === origin && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && !!url.port; } catch { return false; }
}
function readBody(request, limit) {
  const length = request.headers['content-length'];
  requireValue(!length || /^\d+$/.test(length) && Number(length) <= limit, 'body_too_large', '请求体超过限制。', 413);
  return new Promise((resolve, reject) => {
    let bytes = 0, rejected = false; const chunks = [];
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > limit) { if (!rejected) reject(new StorageError('body_too_large', '请求体超过限制。', 413)); rejected = true; chunks.length = 0; }
      else if (!rejected) chunks.push(chunk);
    });
    request.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks)); });
    request.on('error', reject);
    request.on('aborted', () => reject(new StorageError('request_aborted', '请求中断。')));
  });
}

// 授权只通过本机启动器的进程内调用，不提供匿名HTTP发令牌端点。
export async function startDataService({ workspace, allowedOrigins, port = 0, sessionTTL = 10 * 60_000, rateLimit = 120, now = Date.now, writeOptions } = {}) {
  requireValue(workspace?.workspaceId && Array.isArray(allowedOrigins) && allowedOrigins.length > 0 && allowedOrigins.every(validOrigin), 'invalid_service_config', '必须明确列出本机测试Origin。');
  requireValue(Number.isInteger(port) && port >= 0 && port <= 65535 && sessionTTL > 0 && sessionTTL <= 15 * 60_000 && Number.isInteger(rateLimit) && rateLimit > 0, 'invalid_service_config', '服务配置无效。');
  const origins = new Set(allowedOrigins), sessions = new Map();
  const writeGate = createWriteCoordinator(writeOptions);
  let activeRequests = 0, stopping = false, closing;
  const server = createServer(async (request, response) => {
    let counted = false;
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    function json(status, value) { if (!response.destroyed && !response.writableEnded) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); } }
    try {
      requireValue(!stopping, 'service_stopping', '本机服务正在停止。', 503);
      requireValue(request.headers.host === `127.0.0.1:${server.address().port}`, 'host_denied', '拒绝未知Host。', 403);
      const origin = request.headers.origin;
      requireValue(origins.has(origin), 'origin_denied', '页面Origin未授权。', 403);
      response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin');
      const rawPath = request.url;
      requireValue(typeof rawPath === 'string' && rawPath.startsWith('/') && !/[?%\\]/.test(rawPath) && !rawPath.split('/').includes('..'), 'invalid_path', '不接受查询参数或编码路径。');
      if (request.method === 'OPTIONS') {
        const headers = (request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        requireValue(['GET', 'PUT', 'POST'].includes(request.headers['access-control-request-method']) && headers.every(header => ALLOWED_HEADERS.includes(header)), 'preflight_denied', '预检请求未授权。', 403);
        response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, PUT, POST', 'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '), 'Access-Control-Max-Age': '60' }); response.end(); return;
      }
      requireValue(['GET', 'PUT', 'POST'].includes(request.method), 'method_denied', '方法不支持。', 405);
      const token = request.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1], session = sessions.get(token);
      requireValue(session && session.origin === origin && session.expiresAt > now(), 'session_denied', '会话缺失或已过期，请重新授权。', 401);
      if (now() - session.windowStart >= 10_000) { session.windowStart = now(); session.count = 0; }
      requireValue(++session.count <= rateLimit, 'rate_limited', '请求过于频繁，请稍后重试。', 429);
      requireValue(activeRequests < 8, 'service_busy', '本机数据服务繁忙。', 503); activeRequests++; counted = true;
      if (request.method !== 'GET') requireValue(equal(request.headers['x-guan-csrf'], session.csrf), 'csrf_denied', '写入校验失败。', 403);
      // 先鉴权并读完整请求体，再排队；执行前复核撤销/过期及连接关闭。
      async function commitWrite(operation) {
        const cancellation = new AbortController();
        const disconnected = () => { if (!response.writableEnded) cancellation.abort(); };
        request.once('aborted', disconnected); response.once('close', disconnected);
        if (request.aborted || response.destroyed) cancellation.abort();
        try {
          return await writeGate.runWrite(() => {
            requireValue(!stopping, 'service_stopping', '本机服务正在停止。', 503);
            requireValue(sessions.get(token) === session && session.expiresAt > now(), 'session_denied', '等待期间会话已失效，未提交保存。', 401);
            return operation();
          }, { signal: cancellation.signal });
        } finally { request.off('aborted', disconnected); response.off('close', disconnected); }
      }
      if (rawPath === '/health' && request.method === 'GET') { json(200, { protocol: PROTOCOL, workspaceId: workspace.workspaceId }); return; }
      if (rawPath === '/usage' && request.method === 'GET') { const usage = await workspace.readDetailedUsage(); requireValue(sessions.get(token) === session && session.expiresAt > now(), 'session_denied', '统计期间会话已失效，请重新授权。', 401); json(200, usage); return; }
      const match = rawPath.match(/^\/v1\/workspaces\/([^/]+)\/(documents|media|namespace-snapshots)(?:\/([^/]+))?(?:\/([^/]+))?$/);
      requireValue(match, 'route_not_found', '接口不存在。', 404);
      const [, workspaceId, resource, first, second] = match;
      requireValue(validUUID(workspaceId) && workspaceId === workspace.workspaceId, 'workspace_denied', '工作区未授权。', 403);
      if (resource === 'namespace-snapshots') {
        requireValue(request.method === 'GET' && !second, 'method_denied', '命名空间快照只支持读取。', 405);
        const snapshot = await readNamespaceSnapshot(first, (...args) => workspace.readDocument(...args));
        requireValue(sessions.get(token) === session && session.expiresAt > now(), 'session_denied', '读取期间会话已失效。', 401);
        json(200, { ...snapshot, protocol: PROTOCOL, workspaceId }); return;
      }
      if (resource === 'documents') {
        requireValue(COLLECTIONS.includes(first) && (!second || validId(second)), 'invalid_document', '文档路径无效。');
        if (request.method === 'GET') {
          const result = second ? workspace.readDocument(first, second) : workspace.listDocuments(first);
          requireValue(result, 'document_not_found', '文档不存在。', 404); json(200, result); return;
        }
        requireValue(request.method === 'PUT' && second, 'method_denied', '文档只支持读取和指定版本保存。', 405);
        requireValue(!(first === 'extension' && /^(?:provider:|guan-generation-ledger-v1$|guan-network-proxy-state-v1$|guan-fallback-)/.test(second)), 'reserved_generation_document', '生成绑定与任务账本只能由可信本机服务写入。', 403);
        requireValue(request.headers['content-type'] === 'application/json', 'content_type_denied', '必须提交JSON。', 415);
        const bytes = await readBody(request, MAX_JSON_BODY);
        let body; try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new StorageError('invalid_json', 'JSON格式无效。'); }
        requireValue(body && !Array.isArray(body) && typeof body === 'object' && Object.keys(body).every(key => ['value', 'expectedRevision', 'operationId', 'mediaIds'].includes(key)), 'invalid_write', '保存字段无效。');
        json(200, await commitWrite(() => workspace.writeDocument({ ...body, collection: first, id: second }))); return;
      }
      requireValue(!second, 'invalid_media', '媒体路径无效。');
      if (request.method === 'POST' && !first) {
        const bytes = await readBody(request, MAX_MEDIA_BYTES); json(201, await commitWrite(() => workspace.writeMedia(bytes, request.headers['content-type']))); return;
      }
      requireValue(request.method === 'GET' && validHash(first), 'invalid_media', '媒体路径或方法无效。');
      const media = workspace.readMedia(first);
      response.writeHead(200, { 'Content-Type': media.mime, 'Content-Length': media.size, 'Content-Disposition': `attachment; filename="${media.id}"` }); response.end(media.bytes);
    } catch (error) {
      // 不回显底层路径、请求内容、SQL或令牌。SQLite FULL/IOERR也不能伪装成空数据。
      const known = error instanceof StorageError;
      json(known ? error.status : 500, { error: { code: known ? error.code : 'storage_unavailable', message: known ? error.message : '本机存储操作失败，没有报告保存成功。' } });
      request.resume();
    } finally { if (counted) activeRequests--; }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 2_000; server.maxHeadersCount = 32; server.maxConnections = 32;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  server.on('error', () => {}); // 启动失败由上面返回；运行时连接错误不打印原始请求。
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    issueSession(origin) {
      requireValue(!stopping && origins.has(origin), 'origin_denied', 'Origin未授权。', 403);
      for (const [token, session] of sessions) if (session.expiresAt <= now()) sessions.delete(token);
      requireValue(sessions.size < 64, 'too_many_sessions', '会话数量已达上限。', 429);
      const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex'), expiresAt = now() + sessionTTL;
      sessions.set(token, { csrf, origin, expiresAt, windowStart: now(), count: 0 });
      return { protocol: PROTOCOL, workspaceId: workspace.workspaceId, origin, token, csrf, expiresAt };
    },
    revokeSession(token) { sessions.delete(token); },
    // 只有可信进程内入口；不新增HTTP备份/授权端点，不将队列排空等同于所有页面已保存。
    getWriteStatus: writeGate.getStatus,
    runTrustedWrite(operation) { return writeGate.runWrite(() => { requireValue(!stopping, 'service_stopping', '本机服务正在停止。', 503); return operation(); }); },
    createBackup() { return writeGate.runBackup(() => { requireValue(!stopping, 'service_stopping', '本机服务正在停止。', 503); return workspace.createBackup(); }); },
    close() {
      if (!closing) {
        stopping = true; sessions.clear();
        closing = Promise.all([writeGate.close(), new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))]).then(() => {});
      }
      return closing;
    },
  };
}
