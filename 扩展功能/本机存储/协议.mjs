export const PROTOCOL = 'guan-local-data.v1';
export const SCHEMA_VERSION = 1;
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
export const COLLECTIONS = Object.freeze(['canvas', 'extension']);
export const MEDIA_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'application/octet-stream']);

export class StorageError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'StorageError'; this.code = code; this.status = status; }
}
export function requireValue(ok, code, message, status = 400) { if (!ok) throw new StorageError(code, message, status); }
export function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,127}$/.test(value); }
export function validUUID(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
export function validHash(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }

// 只承接业务文档，不提供任意配置/密钥仓库；这不是对提示词内容的完整DLP识别。
export function serializeDocument(collection, id, value, mediaIds = []) {
  requireValue(COLLECTIONS.includes(collection) && validId(id), 'invalid_document', '不支持的业务集合或标识。');
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'invalid_document', '文档必须是对象。');
  const visiting = new Set();
  function inspect(item, depth = 0) {
    requireValue(depth <= 40, 'invalid_document', '文档层级过深。');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number') return requireValue(Number.isFinite(item), 'invalid_document', '数值必须有限。');
    requireValue(typeof item === 'object' && !visiting.has(item), 'invalid_document', '文档含不可序列化值。');
    requireValue(Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, 'invalid_document', '文档只能包含普通JSON数据。');
    visiting.add(item);
    for (const [key, entry] of Object.entries(item)) {
      requireValue(!/^(api[_-]?key|authorization|password|access[_-]?token|refresh[_-]?token|private[_-]?key|secret)$/i.test(key), 'credential_field_rejected', '业务文档不接受凭据字段。');
      requireValue(!(typeof entry === 'string' && /^(url|src|previewUrl)$/i.test(key) && entry.startsWith('blob:')), 'transient_media_url', '临时Blob网址不能作为持久媒体引用。');
      inspect(entry, depth + 1);
    }
    visiting.delete(item);
  }
  inspect(value);
  requireValue(Array.isArray(mediaIds) && mediaIds.length <= 10000 && mediaIds.every(validHash) && new Set(mediaIds).size === mediaIds.length, 'invalid_media_refs', '媒体引用必须为不重复的SHA-256标识。');
  if (collection === 'canvas') {
    requireValue(value.id === id && typeof value.title === 'string' && value.title.length <= 500, 'invalid_canvas', '画布身份或标题无效。');
    requireValue(Array.isArray(value.nodes) && Array.isArray(value.connections), 'invalid_canvas', '画布须包含节点与连线数组。');
    const ids = new Set();
    for (const node of value.nodes) {
      requireValue(node && validId(node.id) && !ids.has(node.id) && typeof node.type === 'string' && node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y), 'invalid_canvas', '节点标识或位置无效。');
      ids.add(node.id);
      if (node.metadata?.storageKey) {
        requireValue(/^media:[0-9a-f]{64}$/.test(node.metadata.storageKey) && mediaIds.includes(node.metadata.storageKey.slice(6)), 'invalid_media_refs', '持久画布只能引用已声明的本机媒体。');
      }
    }
    const connections = new Set();
    for (const edge of value.connections) {
      requireValue(edge && validId(edge.id) && !connections.has(edge.id) && ids.has(edge.fromNodeId) && ids.has(edge.toNodeId), 'invalid_canvas', '连线标识或节点引用无效。');
      connections.add(edge.id);
    }
    if (value.viewport) requireValue(Number.isFinite(value.viewport.x) && Number.isFinite(value.viewport.y) && Number.isFinite(value.viewport.k) && value.viewport.k > 0, 'invalid_canvas', '画布视口无效。');
  }
  const text = JSON.stringify(value);
  requireValue(new TextEncoder().encode(text).length <= MAX_DOCUMENT_BYTES, 'document_too_large', '文档超过本阶段2MiB限制。', 413);
  return text;
}
