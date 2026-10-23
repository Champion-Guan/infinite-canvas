import { createValueCodec } from './应用值编码.mjs';
import { StorageError, requireValue, serializeDocument } from './协议.mjs';

export const APPLICATION_STORAGE_FORMAT = 'guan-app-storage.v1';
export const APP_NAMESPACES = Object.freeze(['app_state', 'image_files', 'image_previews', 'image_generation_logs', 'video_generation_logs', 'media_files', 'prompt_cache', 'preferences']);
const jsonStores = new Set(['infinite-canvas:canvas_store', 'infinite-canvas:asset_store', 'infinite-canvas:plugin_store', 'infinite-canvas:ai_config_store', 'infinite-canvas:theme_store', 'infinite-canvas:prompt_source_store_v2']);
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');

// 兼容当前上游实际使用的localForage子集；不是全量localForage实现。
// 每命名空间一个有版本文档，删除/clear原子提交，文件不立即物理删除。
// 当前2MiB文档限制显式生效；达到限制应停止保存，不分页截断或回退浏览器。
export function createApplicationStorage({ client, secretPort, readBlobUrl, onStatus = () => {} }) {
  const codec = createValueCodec({ client, secretPort, readBlobUrl });
  const spaces = new Map(), errors = new Map();
  let closed = false, pending = 0, hasSaved = false;
  function status() { return { state: errors.size ? 'error' : pending ? 'saving' : hasSaved ? 'saved' : 'idle', pending, errors: [...errors.keys()] }; }
  function notify() { try { onStatus(status()); } catch { /* 订阅器不决定数据库结果。 */ } }
  function state(name) {
    requireValue(!closed && APP_NAMESPACES.includes(name), 'namespace_denied', '未声明的应用存储命名空间；不会重新启用任意插件。');
    if (!spaces.has(name)) spaces.set(name, { name, loaded: false, revision: 0, entries: new Map(), tail: Promise.resolve(), blocked: null });
    return spaces.get(name);
  }
  async function load(space) {
    if (space.loaded) return;
    space.id = 'app-' + await sha(space.name);
    const doc = await client.readDocument('extension', space.id, { allowMissing: true });
    if (doc) {
      const value = doc.value;
      requireValue(value.format === APPLICATION_STORAGE_FORMAT && value.namespace === space.name && Array.isArray(value.entries), 'invalid_namespace', '应用存储格式或命名空间不符；没有作为空库启动。');
      const entries = new Map();
      for (const item of value.entries) {
        requireValue(Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && !entries.has(item[0]) && Array.isArray(item[1]?.tree) && Array.isArray(item[1]?.mediaIds), 'invalid_namespace', '应用记录重复或格式错误。');
        entries.set(item[0], item[1]);
      }
      space.entries = entries; space.revision = doc.revision;
    }
    space.loaded = true;
  }
  function queue(space, fn, { retry = false } = {}) {
    pending++; notify();
    const result = space.tail.then(async () => {
      requireValue(!closed, 'client_closed', '应用存储已关闭。');
      if (space.blocked && !retry) throw new StorageError('pending_write_unresolved', '上一笔保存尚未确认，请先重试同一操作或重新打开工作台。', 409);
      await load(space);
      return fn();
    });
    space.tail = result.then(() => {}, () => {});
    result.then(() => { if (!space.blocked) errors.delete(space.name); }, () => errors.set(space.name, true)).finally(() => { pending--; notify(); });
    return result;
  }
  async function commit(space, entries) {
    const value = { format: APPLICATION_STORAGE_FORMAT, namespace: space.name, entries: [...entries] };
    const mediaIds = [...new Set([...entries.values()].flatMap(entry => entry.mediaIds))].sort();
    // 请求前完成协议/大小检查，失败不成为一个结果不明的操作。
    serializeDocument('extension', space.id, value, mediaIds);
    const write = { collection: 'extension', id: space.id, value, mediaIds, expectedRevision: space.revision, operationId: crypto.randomUUID() };
    space.blocked = { write, entries };
    return retryWrite(space);
  }
  async function retryWrite(space) {
    requireValue(space.blocked, 'nothing_to_retry', '没有待确认的保存。');
    const { write, entries } = space.blocked;
    const ack = await client.writeDocument(write);
    space.entries = entries; space.revision = ack.revision; space.blocked = null; hasSaved = true;
    return ack;
  }
  function createInstance({ name = 'infinite-canvas', storeName = 'app_state' } = {}) {
    requireValue(name === 'infinite-canvas', 'namespace_denied', '插件和其他数据库没有获准接入。');
    const space = state(storeName);
    return {
      getItem(key) {
        requireValue(typeof key === 'string', 'invalid_key', '记录键必须为字符串。');
        return queue(space, async () => {
          const entry = space.entries.get(key);
          if (!entry) return null;
          const value = await codec.decode(entry.tree);
          return storeName === 'app_state' && jsonStores.has(key) ? JSON.stringify(value) : value;
        });
      },
      setItem(key, value) {
        requireValue(typeof key === 'string' && key.length > 0 && key.length <= 512, 'invalid_key', '记录键无效。');
        // 在入队前快照，防止调用者随后原地修改对象导致保存内容漂移。
        const snapshot = structuredClone(value === undefined ? null : value);
        return queue(space, async () => {
          let decoded = snapshot;
          if (storeName === 'app_state' && jsonStores.has(key)) {
            requireValue(typeof snapshot === 'string', 'invalid_state', 'Zustand持久状态必须为JSON字符串。');
            try { decoded = JSON.parse(snapshot); } catch { throw new StorageError('invalid_state', 'Zustand持久状态不是有效JSON。'); }
          }
          const encoded = await codec.encode(decoded, { credential: /(?:^|[:-])(?:api[_-]?key|password|token|secret)$/i.test(key) }), entries = new Map(space.entries);
          entries.set(key, encoded); await commit(space, entries); return value;
        });
      },
      removeItem(key) { return queue(space, async () => { const entries = new Map(space.entries); entries.delete(key); await commit(space, entries); }); },
      clear() { return queue(space, () => commit(space, new Map())); },
      async iterate(iterator) {
        // 先取得一致快照再执行回调，兼容回调内部再次调用存储；不在队列中等回调造成死锁。
        const entries = await queue(space, () => [...space.entries]);
        let index = 0;
        for (const [key, entry] of entries) {
          let value = await codec.decode(entry.tree);
          if (storeName === 'app_state' && jsonStores.has(key)) value = JSON.stringify(value);
          const result = iterator(value, key, ++index);
          if (result !== undefined) return result;
        }
        return undefined;
      },
      keys() { return queue(space, () => [...space.entries.keys()]); },
      length() { return queue(space, () => space.entries.size); },
    };
  }
  return {
    createInstance,
    getStatus: status,
    readUsage() { return client.readUsage(); },
    retry(name) { const space = state(name); return queue(space, () => retryWrite(space), { retry: true }); },
    async flush() {
      await Promise.all([...spaces.values()].map(space => space.tail));
      requireValue(!pending && !errors.size && ![...spaces.values()].some(space => space.blocked), 'save_not_confirmed', '仍有未确认或失败的保存；不能报告已保存。', 409);
      return status();
    },
    close() { requireValue(!pending && !errors.size, 'save_not_confirmed', '未确认保存不能关闭客户端。'); closed = true; codec.close(); },
  };
}
