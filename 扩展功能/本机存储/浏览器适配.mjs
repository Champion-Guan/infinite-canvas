import { MAX_FRAGMENT_BATCH_BYTES, MAX_FRAGMENT_BATCH_COUNT, MAX_MEDIA_BATCH_BYTES, MAX_MEDIA_BATCH_COUNT, PROTOCOL, StorageError, requireValue, serializeDocument, validHash, validId, validUUID } from './协议.mjs';
import { APP_NAMESPACES, NAMESPACE_SNAPSHOT_FORMAT, MAX_NAMESPACE_SNAPSHOT_BYTES } from './命名空间快照.mjs';
import { createMediaBatchBody, MEDIA_BATCH_CONTENT_TYPE } from './媒体批次协议.mjs';

const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const DEFAULT_DOCUMENT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MEDIA_REQUEST_TIMEOUT_MS = 180_000;

// 仅自有模块使用。尚未替换作者的Zustand/localForage，也不写浏览器存储。
export function createDataClient({ url, session, fetchImpl = globalThis.fetch, onStatus = () => {}, mediaRequestTimeoutMs = DEFAULT_MEDIA_REQUEST_TIMEOUT_MS }) {
  const address = new URL(url);
  requireValue(address.origin === url && address.protocol === 'http:' && address.hostname === '127.0.0.1' && !!address.port, 'invalid_endpoint', '数据服务必须是明确的本机地址。');
  requireValue(session?.protocol === PROTOCOL && validUUID(session.workspaceId) && Number.isFinite(session.expiresAt) && /^[0-9a-f]{64}$/.test(session.token) && /^[0-9a-f]{64}$/.test(session.csrf), 'invalid_session', '本机数据会话无效。');
  requireValue(Number.isSafeInteger(mediaRequestTimeoutMs) && mediaRequestTimeoutMs >= 1 && mediaRequestTimeoutMs <= 10 * 60_000,
    'invalid_timeout', '媒体请求等待时间无效。');
  const authorization = { ...session }; // 仅内存，不能写URL、localStorage、IndexedDB或日志。
  let pending = 0, lastAck = null, disposed = false;
  const errors = new Map();
  function status() { return { state: errors.size ? 'error' : pending ? 'saving' : lastAck ? 'saved' : 'idle', pending, lastAck, errors: [...errors.values()] }; }
  function notify() { try { onStatus(status()); } catch { /* 界面订阅器故障不能改变数据库结果。 */ } }
  async function request(path, method = 'GET', body, type, timeout = 15_000, consume = response => response) {
    requireValue(!disposed, 'client_closed', '数据客户端已关闭。');
    requireValue(authorization.expiresAt > Date.now(), 'session_expired', '本机数据会话过期，需要重新授权。', 401);
    const headers = { Authorization: `Bearer ${authorization.token}` };
    if (method !== 'GET') headers['X-Guan-CSRF'] = authorization.csrf;
    if (type) headers['Content-Type'] = type;
    const signal = AbortSignal.timeout(timeout);
    try {
      const response = await fetchImpl(`${url}${path}`, { method, headers, body, credentials: 'omit', redirect: 'error', cache: 'no-store', signal });
      if (!response.ok) {
        const error = (await response.json().catch(() => null))?.error;
        throw new StorageError(error?.code ?? 'service_unavailable', error?.message ?? '本机数据请求失败，未报告保存成功。', response.status);
      }
      return await consume(response);
    } catch (error) {
      if (signal.aborted) throw new StorageError('request_timeout', '本机存储请求超时，结果未确认；请重试原操作。', 504);
      throw error;
    }
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
    storageMaintenance(input) {
      return request(`${base}/storage-maintenance`, 'POST', JSON.stringify(input), 'application/json', 120_000, response => response.json());
    },
    readNamespace(namespace) {
      return operation(`namespace:${namespace}`, async () => {
        requireValue(APP_NAMESPACES.includes(namespace), 'namespace_denied', '未声明的应用存储命名空间。');
        const text = await request(`${base}/namespace-snapshots/${namespace}`, 'GET', undefined, undefined, 30_000, response => response.text());
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
        const usage = await request('/usage', 'GET', undefined, undefined, 30_000, response => response.json());
        requireValue(usage.protocol === PROTOCOL && usage.workspaceId === authorization.workspaceId && Number.isSafeInteger(usage.usage) && usage.usage >= 0 && usage.quota === null && Number.isSafeInteger(usage.contentBytes) && usage.contentBytes >= 0 && Array.isArray(usage.databases), 'invalid_response', '本机容量响应无效。');
        return usage;
      });
    },
    readDocument(collection, id, { allowMissing = false } = {}) {
      return operation(`read:${collection}:${id}`, async () => {
        serializeDocumentKey(collection, id);
        let response;
        try { response = await request(`${base}/documents/${collection}/${id}`, 'GET', undefined, undefined, 30_000, response => response.json()); }
        catch (error) { if (allowMissing && error.code === 'document_not_found' && error.status === 404) return null; throw error; }
        const document = response;
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
        const ack = await request(`${base}/documents/${collection}/${id}`, 'PUT', JSON.stringify({ value, expectedRevision, operationId, mediaIds }), 'application/json', DEFAULT_DOCUMENT_REQUEST_TIMEOUT_MS, response => response.json());
        requireValue(ack.protocol === PROTOCOL && ack.workspaceId === authorization.workspaceId && ack.persisted === true && ack.collection === collection && ack.id === id && ack.operationId === operationId && ack.revision === expectedRevision + 1 && ack.hash === hash, 'invalid_ack', '服务器未返回匹配的落盘确认。');
        lastAck = Object.freeze(ack); return ack;
      });
    },
    writeFragments(fragments) {
      return operation('write:fragments', async () => {
        requireValue(Array.isArray(fragments) && fragments.length > 0 && fragments.length <= MAX_FRAGMENT_BATCH_COUNT,
          'invalid_fragment_batch', '分片批次数量无效。');
        const expected = [];
        for (const fragment of fragments) {
          requireValue(fragment && Object.keys(fragment).length === 3 && /^app-part-[a-f0-9]{64}$/.test(fragment.id) &&
            fragment.value?.format === 'guan-app-fragment.v1' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(fragment.operationId),
          'invalid_fragment_batch', '分片批次字段无效。');
        // 内容寻址哈希在计划阶段生成，并由本机服务在同一事务里重新验证。
        // 客户端只校验服务回执与ID一致，避免每个大分片再次JSON序列化和SHA-256。
        expected.push({ id: fragment.id, operationId: fragment.operationId, hash: fragment.id.slice('app-part-'.length) });
        }
        const body = JSON.stringify({ fragments });
        requireValue(new TextEncoder().encode(body).length <= MAX_FRAGMENT_BATCH_BYTES, 'fragment_batch_too_large', '分片批次超过5MiB上限。', 413);
        const ack = await request(`${base}/fragments`, 'POST', body, 'application/json', DEFAULT_DOCUMENT_REQUEST_TIMEOUT_MS, response => response.json());
        requireValue(Array.isArray(ack) && ack.length === expected.length && ack.every((item, index) =>
          item.protocol === PROTOCOL && item.workspaceId === authorization.workspaceId && item.persisted === true &&
          item.collection === 'extension' && item.id === expected[index].id && item.operationId === expected[index].operationId &&
          item.revision === 1 && item.hash === expected[index].hash),
        'invalid_ack', '服务器未返回完整匹配的分片落盘确认。');
        if (ack.length) lastAck = Object.freeze(ack.at(-1)); return ack;
      });
    },
    writeMedia(blob) {
      return operation('media:upload', async () => {
        requireValue(blob instanceof Blob && blob.size > 0, 'invalid_media', '媒体必须是非空文件。');
        const media = await request(`${base}/media`, 'POST', blob, blob.type || 'application/octet-stream', mediaRequestTimeoutMs, response => response.json());
        requireValue(validHash(media.id) && media.size === blob.size, 'invalid_ack', '媒体落盘确认不匹配。'); return media;
      });
    },
    writeMediaBatch(items) {
      return operation('media:batch', async () => {
        requireValue(Array.isArray(items) && items.length > 0 && items.length <= MAX_MEDIA_BATCH_COUNT &&
          items.every(item => item?.blob instanceof Blob && item.blob.size > 0) &&
          items.reduce((total, item) => total + item.blob.size, 0) <= MAX_MEDIA_BATCH_BYTES,
        'invalid_media_batch', '媒体批次格式无效。');
        const body = createMediaBatchBody(items);
        const result = await request(`${base}/media/batch`, 'POST', body, MEDIA_BATCH_CONTENT_TYPE, mediaRequestTimeoutMs, response => response.json());
        requireValue(Array.isArray(result) && result.length === items.length && result.every((media, index) =>
          validHash(media?.id) && media.size === items[index].blob.size),
        'invalid_ack', '媒体批次落盘确认不完整。');
        return result;
      });
    },
    purgeMedia(ids) {
      return operation('media:cleanup', async () => {
        requireValue(Array.isArray(ids) && ids.length <= 512 && ids.every(validHash), 'invalid_media', '清理候选无效。');
        const result = await request(`${base}/media-cleanup`, 'POST', JSON.stringify({ ids }), 'application/json', 30_000, response => response.json());
        const allowed = new Set(ids), all = ['deleted', 'retained', 'deferred'].flatMap(key => result?.[key] ?? []);
        requireValue(['deleted', 'retained', 'deferred'].every(key => Array.isArray(result?.[key])) && all.every(id => allowed.has(id)) && new Set(all).size === allowed.size && all.length === allowed.size, 'invalid_ack', '清理回执不完整，保留清单供重试。');
        return result;
      });
    },
    readMedia(id) {
      return operation(`media:${id}`, async () => {
        requireValue(validHash(id), 'invalid_media', '媒体标识无效。');
        const blob = await request(`${base}/media/${id}`, 'GET', undefined, undefined, mediaRequestTimeoutMs, response => response.blob());
        requireValue(blob.size > 0, 'invalid_response', '媒体响应为空。'); return blob;
      });
    },
    close() { disposed = true; authorization.token = ''; authorization.csrf = ''; },
  };
}

function serializeDocumentKey(collection, id) {
  requireValue(['canvas', 'extension'].includes(collection) && validId(id), 'invalid_document', '文档标识无效。');
}
