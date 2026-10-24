import { MAX_MEDIA_BYTES, PROTOCOL, StorageError, requireValue, serializeDocument, validHash, validId, validUUID } from './协议.mjs';
import { APP_NAMESPACES, NAMESPACE_SNAPSHOT_FORMAT, MAX_NAMESPACE_SNAPSHOT_BYTES } from './命名空间快照.mjs';

const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

// 仅自有模块使用。尚未替换作者的Zustand/localForage，也不写浏览器存储。
export function createDataClient({ url, session, fetchImpl = globalThis.fetch, onStatus = () => {} }) {
  const address = new URL(url);
  requireValue(address.origin === url && address.protocol === 'http:' && address.hostname === '127.0.0.1' && !!address.port, 'invalid_endpoint', '数据服务必须是明确的本机地址。');
  requireValue(session?.protocol === PROTOCOL && validUUID(session.workspaceId) && Number.isFinite(session.expiresAt) && /^[0-9a-f]{64}$/.test(session.token) && /^[0-9a-f]{64}$/.test(session.csrf), 'invalid_session', '本机数据会话无效。');
  const authorization = { ...session }; // 仅内存，不能写URL、localStorage、IndexedDB或日志。
  let pending = 0, lastAck = null, disposed = false;
  const errors = new Map();
  function status() { return { state: errors.size ? 'error' : pending ? 'saving' : lastAck ? 'saved' : 'idle', pending, lastAck, errors: [...errors.values()] }; }
  function notify() { try { onStatus(status()); } catch { /* 界面订阅器故障不能改变数据库结果。 */ } }
  async function request(path, method = 'GET', body, type) {
    requireValue(!disposed, 'client_closed', '数据客户端已关闭。');
    requireValue(authorization.expiresAt > Date.now(), 'session_expired', '本机数据会话过期，需要重新授权。', 401);
    const headers = { Authorization: `Bearer ${authorization.token}` };
    if (method !== 'GET') headers['X-Guan-CSRF'] = authorization.csrf;
    if (type) headers['Content-Type'] = type;
    const response = await fetchImpl(`${url}${path}`, { method, headers, body, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const error = (await response.json().catch(() => null))?.error;
      throw new StorageError(error?.code ?? 'service_unavailable', error?.message ?? '本机数据请求失败，未报告保存成功。', response.status);
    }
    return response;
  }
  const base = `/v1/workspaces/${authorization.workspaceId}`;
  async function operation(key, fn) {
    pending++; notify();
    try { const result = await fn(); errors.delete(key); return result; }
    catch (error) { errors.set(key, { key, code: error.code ?? 'connection_failed', message: error instanceof StorageError ? error.message : '连接中断，保存结果未确认；请使用相同操作ID重试。' }); throw error; }
    finally { pending--; notify(); }
  }
  return {
    getStatus: status,
    readNamespace(namespace) {
      return operation(`namespace:${namespace}`, async () => {
        requireValue(APP_NAMESPACES.includes(namespace), 'namespace_denied', '未声明的应用存储命名空间。');
        const text = await (await request(`${base}/namespace-snapshots/${namespace}`)).text();
        requireValue(new TextEncoder().encode(text).length <= MAX_NAMESPACE_SNAPSHOT_BYTES + 64 * 1024, 'invalid_response', '命名空间响应超过上限。');
        const snapshot = JSON.parse(text);
        requireValue(snapshot.protocol === PROTOCOL && snapshot.workspaceId === authorization.workspaceId && snapshot.format === NAMESPACE_SNAPSHOT_FORMAT && snapshot.namespace === namespace && Array.isArray(snapshot.fragments) && snapshot.fragments.length <= 4096 && (snapshot.root === null ? snapshot.fragments.length === 0 : snapshot.root?.value?.namespace === namespace), 'invalid_response', '命名空间快照身份或目录无效。');
        const ids = new Set();
        for (const document of [snapshot.root, ...snapshot.fragments].filter(Boolean)) {
          requireValue(document.workspaceId === authorization.workspaceId && document.collection === 'extension' && validId(document.id) && !ids.has(document.id) && Number.isSafeInteger(document.revision) && document.revision > 0, 'invalid_response', '命名空间文档身份或版本无效。');
          const body = serializeDocument('extension', document.id, document.value, document.mediaIds);
          requireValue(await digest(new TextEncoder().encode(body)) === document.hash, 'invalid_response', '命名空间文档校验失败。');
          ids.add(document.id);
        }
        return snapshot;
      });
    },
    readUsage() {
      return operation('read:usage', async () => {
        const usage = await (await request('/usage')).json();
        requireValue(usage.protocol === PROTOCOL && usage.workspaceId === authorization.workspaceId && Number.isSafeInteger(usage.usage) && usage.usage >= 0 && usage.quota === null && Number.isSafeInteger(usage.contentBytes) && usage.contentBytes >= 0 && Array.isArray(usage.databases), 'invalid_response', '本机容量响应无效。');
        return usage;
      });
    },
    readDocument(collection, id, { allowMissing = false } = {}) {
      return operation(`read:${collection}:${id}`, async () => {
        serializeDocumentKey(collection, id);
        let response;
        try { response = await request(`${base}/documents/${collection}/${id}`); }
        catch (error) { if (allowMissing && error.code === 'document_not_found' && error.status === 404) return null; throw error; }
        const document = await response.json();
        requireValue(document.workspaceId === authorization.workspaceId && document.id === id && document.collection === collection && Number.isSafeInteger(document.revision) && document.revision > 0, 'invalid_response', '工作区或文档响应不匹配。');
        const body = serializeDocument(collection, id, document.value, document.mediaIds);
        requireValue(await digest(new TextEncoder().encode(body)) === document.hash, 'invalid_response', '文档响应校验失败。');
        return document;
      });
    },
    writeDocument({ collection, id, value, expectedRevision, operationId, mediaIds = [] }) {
      return operation(`write:${collection}:${id}`, async () => {
        const body = serializeDocument(collection, id, value, mediaIds);
        const hash = await digest(new TextEncoder().encode(body));
        const ack = await (await request(`${base}/documents/${collection}/${id}`, 'PUT', JSON.stringify({ value, expectedRevision, operationId, mediaIds }), 'application/json')).json();
        requireValue(ack.protocol === PROTOCOL && ack.workspaceId === authorization.workspaceId && ack.persisted === true && ack.collection === collection && ack.id === id && ack.operationId === operationId && ack.revision === expectedRevision + 1 && ack.hash === hash, 'invalid_ack', '服务器未返回匹配的落盘确认。');
        lastAck = Object.freeze(ack); return ack;
      });
    },
    writeMedia(blob) {
      return operation('media:upload', async () => {
        requireValue(blob instanceof Blob && blob.size > 0 && blob.size <= MAX_MEDIA_BYTES, 'invalid_media', '媒体大小无效。');
        const id = await digest(await blob.arrayBuffer());
        const media = await (await request(`${base}/media`, 'POST', blob, blob.type || 'application/octet-stream')).json();
        requireValue(media.id === id && media.size === blob.size, 'invalid_ack', '媒体落盘确认不匹配。'); return media;
      });
    },
    readMedia(id) {
      return operation(`media:${id}`, async () => {
        requireValue(validHash(id), 'invalid_media', '媒体标识无效。');
        const blob = await (await request(`${base}/media/${id}`)).blob();
        requireValue(blob.size <= MAX_MEDIA_BYTES && await digest(await blob.arrayBuffer()) === id, 'invalid_response', '媒体响应校验失败。'); return blob;
      });
    },
    close() { disposed = true; authorization.token = ''; authorization.csrf = ''; },
  };
}

function serializeDocumentKey(collection, id) {
  requireValue(['canvas', 'extension'].includes(collection) && validId(id), 'invalid_document', '文档标识无效。');
}
