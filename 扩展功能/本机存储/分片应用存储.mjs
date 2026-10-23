import { createValueCodec } from './应用值编码.mjs';
import { APP_NAMESPACES, APPLICATION_STORAGE_FORMAT } from './应用存储适配.mjs';
import { StorageError, requireValue, serializeDocument, validHash } from './协议.mjs';
import { buildFragmentPlan, readFragmentGraph, verifyFragment } from './分片值编码.mjs';

export const SHARDED_APPLICATION_FORMAT = 'guan-app-storage.v2';
const jsonStores = new Set(['infinite-canvas:canvas_store', 'infinite-canvas:asset_store', 'infinite-canvas:plugin_store', 'infinite-canvas:ai_config_store', 'infinite-canvas:theme_store', 'infinite-canvas:prompt_source_store_v2']);
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const mediaRefs = entries => [...new Set([...entries.values()].flatMap(entry => entry.mediaIds))].sort();
const requestWindows = new WeakMap();
// 原服务每会话120次/10秒保持不变；应用分片最多96次/10.05秒，为其他状态请求留余量。
// 同一客户端跨namespace/恢复实例共享窗口。等待不是丢弃或重发，写入仍保留原operationId。
function pacedClient(client) {
  requireValue(client && typeof client.readDocument === 'function', 'invalid_client', '分片客户端缺少读取端口。');
  if (requestWindows.has(client)) return requestWindows.get(client);
  const starts = [];
  async function request(method, args) {
    requireValue(typeof client[method] === 'function', 'storage_port_denied', '当前存储端口未开放此操作。');
    while (true) {
      const time = performance.now();
      while (starts.length && time - starts[0] >= 10_050) starts.shift();
      if (starts.length < 96) { starts.push(time); return client[method](...args); }
      await new Promise(resolve => setTimeout(resolve, Math.ceil(10_050 - (time - starts[0]))));
    }
  }
  const port = Object.fromEntries(['readDocument', 'writeDocument', 'readMedia', 'writeMedia', 'readUsage'].map(method => [method, (...args) => request(method, args)]));
  requestWindows.set(client, port); return port;
}
function parseEntries(value) {
  requireValue(Array.isArray(value), 'invalid_namespace', '命名空间记录目录格式无效。');
  const entries = new Map();
  for (const item of value) {
    requireValue(Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && item[0].length > 0 && item[0].length <= 512 && !entries.has(item[0]) && Array.isArray(item[1]?.tree) && Array.isArray(item[1]?.mediaIds) && item[1].mediaIds.every(validHash) && new Set(item[1].mediaIds).size === item[1].mediaIds.length,
      'invalid_namespace', '命名空间记录重复、媒体引用或应用值格式错误。');
    entries.set(item[0], item[1]);
  }
  return entries;
}

// 新模块，不修改已批准v1适配器。不可变块先ACK，再以原根ID+revision CAS发布完整一代。
// 当前无块GC；失败块和旧代保留，不能借清理删除仍被其他会话/备份使用的数据。
export function createShardedApplicationStorage({ client, secretPort, readBlobUrl, onStatus = () => {} }) {
  client = pacedClient(client);
  const codec = createValueCodec({ client, secretPort, readBlobUrl }), spaces = new Map(), known = new Set(), errors = new Map();
  let pending = 0, closed = false, hasSaved = false;
  const status = () => ({ state: errors.size ? 'error' : pending ? 'saving' : hasSaved ? 'saved' : 'idle', pending, errors: [...errors.keys()] });
  function notify() { try { onStatus(status()); } catch { /* UI观察器不决定持久化结果。 */ } }
  function state(name) {
    requireValue(!closed && APP_NAMESPACES.includes(name), 'namespace_denied', '未声明的应用存储命名空间。');
    if (!spaces.has(name)) spaces.set(name, { name, loaded: false, revision: 0, entries: new Map(), tail: Promise.resolve(), blocked: null });
    return spaces.get(name);
  }
  async function load(space) {
    if (space.loaded) return;
    space.id = 'app-' + await sha(space.name);
    const document = await client.readDocument('extension', space.id, { allowMissing: true });
    if (document) {
      const value = document.value;
      requireValue(value?.namespace === space.name && Number.isSafeInteger(document.revision) && document.revision > 0, 'invalid_namespace', '命名空间或版本不符，没有作为空库启动。');
      let entries; const verified = new Set();
      if (value.format === APPLICATION_STORAGE_FORMAT) entries = parseEntries(value.entries);
      else {
        requireValue(value.format === SHARDED_APPLICATION_FORMAT && Object.keys(value).length === 4 && Number.isSafeInteger(value.entryCount) && value.entryCount >= 0, 'invalid_namespace', '未知分片命名空间格式，没有降级或覆盖。');
        entries = parseEntries(await readFragmentGraph({ head: value.head, readDocument: async (...args) => {
          const part = await client.readDocument(...args); verified.add(args[1]); return part;
        } }));
        requireValue(entries.size === value.entryCount, 'invalid_namespace', '分片记录数量不符，没有跳过缺失记录。');
      }
      requireValue(Array.isArray(document.mediaIds) && JSON.stringify([...document.mediaIds].sort()) === JSON.stringify(mediaRefs(entries)), 'invalid_namespace', '根目录与应用值媒体引用不一致。');
      // 整张图和根媒体目录全部验证后，才复用刚读取的不可变块，避免刷新后首笔编辑再读全库。
      for (const id of verified) known.add(id);
      space.entries = entries; space.revision = document.revision;
    }
    space.loaded = true;
  }
  function queue(space, fn, { retry = false } = {}) {
    pending++; notify();
    const result = space.tail.then(async () => {
      requireValue(!closed, 'client_closed', '应用存储已关闭。');
      if (space.blocked && !retry) throw new StorageError('pending_write_unresolved', '上一笔分片保存尚未确认，请重试原操作。', 409);
      await load(space); return fn();
    });
    // 先完成计数/错误状态，再向调用方交付结果，避免await读取后立即close仍被误判忙碌。
    const tracked = result.then(value => { if (!space.blocked) errors.delete(space.name); pending--; notify(); return value; }, error => { errors.set(space.name, true); pending--; notify(); throw error; });
    space.tail = tracked.then(() => {}, () => {});
    return tracked;
  }
  async function confirmed(write) {
    const ack = await client.writeDocument(write);
    requireValue(ack?.persisted === true && ack.collection === write.collection && ack.id === write.id && ack.operationId === write.operationId && ack.revision === write.expectedRevision + 1 && ack.hash === await sha(JSON.stringify(write.value)), 'invalid_ack', '分片或根目录没有收到匹配的落盘确认。');
    return ack;
  }
  async function savePart(step) {
    if (known.has(step.id)) return;
    if (!step.write) {
      const existing = await client.readDocument('extension', step.id, { allowMissing: true });
      if (existing) { await verifyFragment(existing, { id: step.id }); known.add(step.id); return; }
      step.write = { collection: 'extension', id: step.id, value: step.value, expectedRevision: 0, operationId: crypto.randomUUID(), mediaIds: [] };
    }
    try { await confirmed(step.write); }
    catch (error) {
      if (error.code !== 'revision_conflict') throw error;
      // 仅内容寻址块可接受另一会话写入的相同内容；根目录冲突绝不覆盖。
      await verifyFragment(await client.readDocument('extension', step.id), { id: step.id });
    }
    known.add(step.id);
  }
  async function retryWrite(space) {
    requireValue(space.blocked, 'nothing_to_retry', '没有待确认的分片保存。');
    const plan = space.blocked;
    while (plan.index < plan.parts.length) { await savePart(plan.parts[plan.index]); plan.index++; }
    const ack = await confirmed(plan.root);
    space.entries = plan.entries; space.revision = ack.revision; space.blocked = null; hasSaved = true; return ack;
  }
  async function commit(space, entries) {
    const plan = await buildFragmentPlan([...entries]), value = { format: SHARDED_APPLICATION_FORMAT, namespace: space.name, head: plan.head, entryCount: entries.size }, mediaIds = mediaRefs(entries);
    serializeDocument('extension', space.id, value, mediaIds);
    space.blocked = { entries, index: 0, parts: [...plan.fragments.values()], root: { collection: 'extension', id: space.id, value, mediaIds, expectedRevision: space.revision, operationId: crypto.randomUUID() } };
    return retryWrite(space);
  }
  function createInstance({ name = 'infinite-canvas', storeName = 'app_state' } = {}) {
    requireValue(name === 'infinite-canvas', 'namespace_denied', '插件和其他数据库未获准接入。');
    const space = state(storeName), json = jsonStores.has.bind(jsonStores);
    async function decode(key, entry) { const value = await codec.decode(entry.tree); return storeName === 'app_state' && json(key) ? JSON.stringify(value) : value; }
    return {
      getItem(key) {
        requireValue(typeof key === 'string', 'invalid_key', '记录键必须为字符串。');
        return queue(space, () => space.entries.has(key) ? decode(key, space.entries.get(key)) : null);
      },
      setItem(key, value) {
        requireValue(typeof key === 'string' && key.length > 0 && key.length <= 512, 'invalid_key', '记录键无效。');
        const snapshot = structuredClone(value === undefined ? null : value);
        return queue(space, async () => {
          let decoded = snapshot;
          if (storeName === 'app_state' && json(key)) {
            requireValue(typeof snapshot === 'string', 'invalid_state', 'Zustand状态必须为JSON字符串。');
            try { decoded = JSON.parse(snapshot); } catch { throw new StorageError('invalid_state', '应用状态不是有效JSON。'); }
          }
          const encoded = await codec.encode(decoded, { credential: /(?:^|[:-])(?:api[_-]?key|password|token|secret)$/i.test(key) }), entries = new Map(space.entries);
          entries.set(key, encoded); await commit(space, entries); return value;
        });
      },
      removeItem(key) { return queue(space, () => { const entries = new Map(space.entries); entries.delete(key); return commit(space, entries); }); },
      clear() { return queue(space, () => commit(space, new Map())); },
      keys() { return queue(space, () => [...space.entries.keys()]); },
      length() { return queue(space, () => space.entries.size); },
      async iterate(callback) {
        const snapshot = await queue(space, () => [...space.entries]); let index = 0;
        for (const [key, entry] of snapshot) { const result = callback(await decode(key, entry), key, ++index); if (result !== undefined) return result; }
        return undefined;
      },
    };
  }
  return {
    createInstance, getStatus: status, readUsage: () => client.readUsage(),
    retry(name) { const space = state(name); return queue(space, () => retryWrite(space), { retry: true }); },
    async flush() {
      await Promise.all([...spaces.values()].map(space => space.tail));
      requireValue(!pending && !errors.size && ![...spaces.values()].some(space => space.blocked), 'save_not_confirmed', '仍有未确认分片或根提交，不能报告已保存。', 409);
      return status();
    },
    close() { requireValue(!pending && !errors.size, 'save_not_confirmed', '未确认保存不能关闭客户端。'); closed = true; codec.close(); },
  };
}
