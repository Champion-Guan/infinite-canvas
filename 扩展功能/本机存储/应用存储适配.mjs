import { createValueCodec } from './应用值编码.mjs';
import { APP_NAMESPACES, APPLICATION_STORAGE_FORMAT, StorageError, requireValue, serializeDocument } from './协议.mjs';
import { readFragmentGraph } from './分片值编码.mjs';

export { APP_NAMESPACES, APPLICATION_STORAGE_FORMAT };
const jsonStores = new Set(['infinite-canvas:canvas_store', 'infinite-canvas:asset_store', 'infinite-canvas:plugin_store', 'infinite-canvas:ai_config_store', 'infinite-canvas:theme_store', 'infinite-canvas:prompt_source_store_v2']);
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');

// 兼容当前上游实际使用的localForage子集；不是全量localForage实现。
// 旧分片只读兼容；所有新保存直接以一个SQLite文档事务提交。
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
    let doc = await client.readDocument('extension', space.id, { allowMissing: true });
    let legacyParts;
    if (doc?.value?.format === 'guan-app-storage.v2' && typeof client.readNamespace === 'function') {
      const snapshot = await client.readNamespace(space.name);
      requireValue(snapshot?.root?.id === space.id && snapshot.root.revision >= doc.revision,
        'invalid_namespace', '旧分片快照与命名空间根不匹配。');
      doc = snapshot.root;
      legacyParts = new Map(snapshot.fragments.map(part => [part.id, part]));
    }
    if (doc) {
      const value = doc.value;
      requireValue(value.namespace === space.name, 'invalid_namespace', '应用存储命名空间不符；没有作为空库启动。');
      let sourceEntries;
      if (value.format === APPLICATION_STORAGE_FORMAT) sourceEntries = value.entries;
      else {
        requireValue(value.format === 'guan-app-storage.v2' && Number.isSafeInteger(value.entryCount) && value.entryCount >= 0,
          'invalid_namespace', '旧分片存储格式无效；没有作为空库启动。');
        sourceEntries = await readFragmentGraph({ head: value.head, readDocument: async (collection, id) => {
          if (legacyParts) return legacyParts.get(id) ?? null;
          return client.readDocument(collection, id);
        } });
        requireValue(sourceEntries.length === value.entryCount, 'invalid_namespace', '旧分片条数不符；没有跳过记录。');
      }
      requireValue(Array.isArray(sourceEntries), 'invalid_namespace', '应用存储目录无效；没有作为空库启动。');
      const entries = new Map();
      for (const item of sourceEntries) {
        requireValue(Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && !entries.has(item[0]) && Array.isArray(item[1]?.tree) && Array.isArray(item[1]?.mediaIds), 'invalid_namespace', '应用记录重复或格式错误。');
        entries.set(item[0], item[1]);
      }
      if (Array.isArray(doc.mediaIds)) {
        const refs = [...new Set([...entries.values()].flatMap(entry => entry.mediaIds))].sort();
        requireValue(JSON.stringify([...doc.mediaIds].sort()) === JSON.stringify(refs), 'invalid_namespace', '命名空间媒体索引与应用记录不一致。');
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
    const tracked = result.then(value => {
      if (!space.blocked) errors.delete(space.name);
      pending--; notify(); return value;
    }, error => { errors.set(space.name, true); pending--; notify(); throw error; });
    space.tail = tracked.then(() => {}, () => {});
    return tracked;
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
    requireValue(ack?.persisted === true && ack.collection === write.collection && ack.id === write.id &&
      ack.operationId === write.operationId && ack.revision === write.expectedRevision + 1 && ack.hash === await sha(JSON.stringify(write.value)),
    'invalid_ack', '保存没有收到匹配的落盘确认，原操作保留供重试。');
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
      removeItems(keys) {
        requireValue(Array.isArray(keys) && keys.length <= 1024 && keys.every(key => typeof key === 'string' && key.length > 0 && key.length <= 512), 'invalid_key', '批量删除的记录键无效。');
        return queue(space, () => {
          const entries = new Map(space.entries);
          for (const key of new Set(keys)) entries.delete(key);
          return commit(space, entries);
        });
      },
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
    async mediaIdsForKeys(groups) {
      const ids = new Set();
      for (const [name, keys] of Object.entries(groups)) {
        const space = state(name);
        await queue(space, () => { for (const key of keys) for (const id of space.entries.get(key)?.mediaIds ?? []) ids.add(id); });
      }
      return [...ids];
    },
    async purgeMedia(ids) {
      requireValue(typeof client.purgeMedia === 'function', 'cleanup_unavailable', '当前服务不支持媒体清理，请重启服务后重试。');
      codec.invalidateMedia();
      try { return await client.purgeMedia(ids); } finally { codec.invalidateMedia(); }
    },
    retry(name) { const space = state(name); return queue(space, () => retryWrite(space), { retry: true }); },
    async flush() {
      await Promise.all([...spaces.values()].map(space => space.tail));
      requireValue(!pending && !errors.size && ![...spaces.values()].some(space => space.blocked), 'save_not_confirmed', '仍有未确认或失败的保存；不能报告已保存。', 409);
      return status();
    },
    close() { requireValue(!pending && !errors.size, 'save_not_confirmed', '未确认保存不能关闭客户端。'); closed = true; codec.close(); },
  };
}
