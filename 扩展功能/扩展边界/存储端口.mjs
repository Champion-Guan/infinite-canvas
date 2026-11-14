import { requireValue, validId, validUUID } from '../本机存储/协议.mjs';

export const EXTENSION_STORAGE_PORT = 'guan-extension-storage.v1';

// 可审查自有模块的依赖边界，不是同源JS的安全沙箱，也不启用任意插件。
export function createExtensionStorage({ extensionId, client }) {
  requireValue(typeof extensionId === 'string' && /^[a-z][a-z0-9-]{1,39}$/.test(extensionId) && client?.readDocument && client?.writeDocument, 'invalid_extension', '扩展身份或存储端口无效。');
  function key(id) {
    requireValue(validId(id) && /^[A-Za-z0-9_-]{1,64}$/.test(id), 'invalid_extension_key', '扩展记录标识无效。');
    return `${extensionId}::${id}`;
  }
  return Object.freeze({
    protocol: EXTENSION_STORAGE_PORT,
    read(id) { return client.readDocument('extension', key(id)); },
    write({ id, value, expectedRevision, operationId, mediaIds = [] }) {
      requireValue(validUUID(operationId), 'invalid_write', '调用方须持有操作ID，重试时复用。');
      return client.writeDocument({ collection: 'extension', id: key(id), value, expectedRevision, operationId, mediaIds });
    },
  });
}
