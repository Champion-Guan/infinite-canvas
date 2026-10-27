import { readFragmentGraph, MAX_GRAPH_FRAGMENTS } from './分片值编码.mjs';
import { APP_NAMESPACES, APPLICATION_STORAGE_FORMAT, requireValue } from './协议.mjs';

export const NAMESPACE_SNAPSHOT_FORMAT = 'guan-namespace-snapshot.v1';
export const MAX_NAMESPACE_SNAPSHOT_BYTES = 64 * 1024 * 1024;
export { APP_NAMESPACES };

// 只读取指定根可达的不可变块，绝不列举整库或把损坏数据当成空库。
// 服务端仍鉴权、限流；客户端收到后仍逐块核验内容与完整性。
export async function readNamespaceSnapshot(namespace, readDocument) {
  requireValue(APP_NAMESPACES.includes(namespace), 'namespace_denied', '未声明的应用存储命名空间。');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(namespace)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const root = await readDocument('extension', 'app-' + hash), fragments = new Map();
  let bytes = root ? new TextEncoder().encode(JSON.stringify(root)).length : 0;
  if (root) {
    requireValue(root.value?.namespace === namespace && [APPLICATION_STORAGE_FORMAT, 'guan-app-storage.v2'].includes(root.value?.format), 'invalid_namespace', '命名空间快照根无效。');
    if (root.value.format === 'guan-app-storage.v2') await readFragmentGraph({ head: root.value.head, readDocument: async (collection, id) => {
      const part = await readDocument(collection, id);
      if (part && !fragments.has(id)) {
        bytes += new TextEncoder().encode(JSON.stringify(part)).length;
        requireValue(bytes <= MAX_NAMESPACE_SNAPSHOT_BYTES && fragments.size < MAX_GRAPH_FRAGMENTS, 'snapshot_too_large', '命名空间快照超过有界读取范围。', 413);
        fragments.set(id, part);
      }
      return part;
    } });
  }
  return { format: NAMESPACE_SNAPSHOT_FORMAT, namespace, root, fragments: [...fragments.values()] };
}
