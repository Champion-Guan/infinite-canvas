import { createValueCodec } from './应用值编码.mjs';
import { APP_NAMESPACES, APPLICATION_STORAGE_FORMAT } from './应用存储适配.mjs';
import { StorageError, requireValue, serializeDocument, validHash } from './协议.mjs';
import { buildFragmentPlan, readFragmentGraph, verifyFragment } from './分片值编码.mjs';
import { createPacedDataClient } from './请求调度.mjs';
import { retainUnchangedCanvasTimestamps } from './画布时间去重.mjs';

export const SHARDED_APPLICATION_FORMAT = 'guan-app-storage.v2';
const jsonStores = new Set(['infinite-canvas:canvas_store', 'infinite-canvas:asset_store', 'infinite-canvas:plugin_store', 'infinite-canvas:ai_config_store', 'infinite-canvas:theme_store', 'infinite-canvas:prompt_source_store_v2']);
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const mediaRefs = entries => [...new Set([...entries.values()].flatMap(entry => entry.mediaIds))].sort();
function saveFailure(error, stage) {
  if (!(error instanceof Error)) error = new StorageError('connection_failed', '保存响应未确认，请保留页面并重试。', 503);
  error.saveStage = stage;
  return error;
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
export function createShardedApplicationStorage({ client, secretPort, readBlobUrl, namespaceSnapshots = false, requestLimit = 96, onStatus = () => {} }) {
  client = createPacedDataClient(client, { reserveWrites: namespaceSnapshots, requestLimit });
  const codec = createValueCodec({ client, secretPort, readBlobUrl }), spaces = new Map(), known = new Set(), errors = new Map();
  let pending = 0, pendingWrites = 0, closed = false, hasSaved = false;
  const status = () => ({ state: errors.size ? 'error' : pendingWrites ? 'saving' : hasSaved ? 'saved' : 'idle', pending: pendingWrites, reads: pending - pendingWrites, errors: [...errors.keys()],
    failures: [...errors].map(([namespace, error]) => ({ namespace, code: /^[a-z_]{3,64}$/.test(error?.code) ? error.code : 'connection_failed',
      stage: error?.saveStage ?? 'prepare', status: Number.isInteger(error?.status) ? error.status : null })) });
  function notify() { try { onStatus(status()); } catch { /* UI观察器不决定持久化结果。 */ } }
  function state(name) {
    requireValue(!closed && APP_NAMESPACES.includes(name), 'namespace_denied', '未声明的应用存储命名空间。');
    if (!spaces.has(name)) spaces.set(name, { name, loaded: false, revision: 0, entries: new Map(), tail: Promise.resolve(), writeTail: Promise.resolve(), blocked: null });
    return spaces.get(name);
  }
  async function load(space) {
    if (space.loaded) return;
    const started = performance.now();
    space.id = 'app-' + await sha(space.name);
    const snapshot = namespaceSnapshots && typeof client.readNamespace === 'function' ? await client.readNamespace(space.name) : null;
    const document = snapshot ? snapshot.root : await client.readDocument('extension', space.id, { allowMissing: true });
    requireValue(!document || document.collection === 'extension' && document.id === space.id, 'invalid_namespace', '命名空间根身份不符。');
    const parts = snapshot ? new Map(snapshot.fragments.map(part => [part.id, part])) : null;
    if (document) {
      const value = document.value;
      requireValue(value?.namespace === space.name && Number.isSafeInteger(document.revision) && document.revision > 0, 'invalid_namespace', '命名空间或版本不符，没有作为空库启动。');
      let entries; const verified = new Set();
      if (value.format === APPLICATION_STORAGE_FORMAT) entries = parseEntries(value.entries);
      else {
        requireValue(value.format === SHARDED_APPLICATION_FORMAT && Object.keys(value).length === 4 && Number.isSafeInteger(value.entryCount) && value.entryCount >= 0, 'invalid_namespace', '未知分片命名空间格式，没有降级或覆盖。');
        entries = parseEntries(await readFragmentGraph({ head: value.head, readDocument: async (...args) => {
          const part = parts ? parts.get(args[1]) : await client.readDocument(...args); verified.add(args[1]); return part;
        } }));
        requireValue(entries.size === value.entryCount, 'invalid_namespace', '分片记录数量不符，没有跳过缺失记录。');
      }
      requireValue(Array.isArray(document.mediaIds) && JSON.stringify([...document.mediaIds].sort()) === JSON.stringify(mediaRefs(entries)), 'invalid_namespace', '根目录与应用值媒体引用不一致。');
      // 整张图和根媒体目录全部验证后，才复用刚读取的不可变块，避免刷新后首笔编辑再读全库。
      for (const id of verified) known.add(id);
      space.entries = entries; space.revision = document.revision;
      space.committedHead = value.format === SHARDED_APPLICATION_FORMAT ? value.head.id : null;
    }
    space.loaded = true;
    if (performance.now() - started > 500) console.debug('[存储性能] 读取目录 ' + JSON.stringify({ namespace: space.name, elapsedMs: Math.round(performance.now() - started), entries: space.entries.size }));
  }
  function queue(space, fn, { retry = false, write = false } = {}) {
    pending++; if (write) pendingWrites++; notify();
    const result = space.tail.then(async () => {
      requireValue(!closed, 'client_closed', '应用存储已关闭。');
      if (space.blocked && !retry) throw new StorageError('pending_write_unresolved', '上一笔分片保存尚未确认，请重试原操作。', 409);
      await load(space); return fn();
    });
    // 先完成计数/错误状态，再向调用方交付结果，避免await读取后立即close仍被误判忙碌。
    const tracked = result.then(value => { if (!space.blocked) errors.delete(space.name); pending--; if (write) pendingWrites--; notify(); return value; }, error => { errors.set(space.name, error); pending--; if (write) pendingWrites--; notify(); throw error; });
    space.tail = tracked.then(() => {}, () => {});
    if (write) space.writeTail = space.tail;
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
      const existing = await client.readForWrite('extension', step.id, { allowMissing: true });
      if (existing) { await verifyFragment(existing, { id: step.id }); known.add(step.id); return; }
      step.write = { collection: 'extension', id: step.id, value: step.value, expectedRevision: 0, operationId: crypto.randomUUID(), mediaIds: [] };
    }
    try { await confirmed(step.write); }
    catch (error) {
      if (error.code !== 'revision_conflict') throw error;
      // 仅内容寻址块可接受另一会话写入的相同内容；根目录冲突绝不覆盖。
      await verifyFragment(await client.readForWrite('extension', step.id), { id: step.id });
    }
    known.add(step.id);
  }
  async function retryWrite(space) {
    requireValue(space.blocked, 'nothing_to_retry', '没有待确认的分片保存。');
    const plan = space.blocked;
    while (plan.index < plan.parts.length) {
      // 不可变内容块可限量并发，根目录仍等待全部ACK后才CAS发布。
      // 一批全部收口再报告失败；重试复用已确认块及未确认块原operationId。
      const batch = plan.parts.slice(plan.index, plan.index + 4);
      const results = await Promise.allSettled(batch.map(savePart));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw saveFailure(failure.reason, 'fragment');
      plan.index += batch.length;
    }
    let ack;
    try { ack = await confirmed(plan.root); }
    catch (error) { throw saveFailure(error, 'root'); }
    space.entries = plan.entries; space.revision = ack.revision; space.committedHead = plan.root.value.head.id; space.blocked = null; hasSaved = true; return ack;
  }
  async function commit(space, entries) {
    const started = performance.now();
    const plan = await buildFragmentPlan([...entries]), value = { format: SHARDED_APPLICATION_FORMAT, namespace: space.name, head: plan.head, entryCount: entries.size }, mediaIds = mediaRefs(entries);
    if (space.committedHead === plan.head.id) { space.entries = entries; hasSaved = true; return; }
    serializeDocument('extension', space.id, value, mediaIds);
    space.blocked = { entries, index: 0, parts: [...plan.fragments.values()], root: { collection: 'extension', id: space.id, value, mediaIds, expectedRevision: space.revision, operationId: crypto.randomUUID() } };
    const newParts = [...plan.fragments.keys()].filter(id => !known.has(id)).length;
    const result = await retryWrite(space);
    if (performance.now() - started > 500) console.debug('[存储性能] 提交 ' + JSON.stringify({ namespace: space.name, elapsedMs: Math.round(performance.now() - started), parts: plan.fragments.size, newParts }));
    return result;
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
          const started = performance.now();
          const encoded = await codec.encode(decoded, { credential: /(?:^|[:-])(?:api[_-]?key|password|token|secret)$/i.test(key) }), entries = new Map(space.entries);
          if (storeName === 'app_state' && key === 'infinite-canvas:canvas_store') retainUnchangedCanvasTimestamps(space.entries.get(key), encoded);
          if (performance.now() - started > 500) console.debug('[存储性能] 编码 ' + JSON.stringify({ namespace: space.name, store: json(key) ? key : '非状态记录', elapsedMs: Math.round(performance.now() - started) }));
          // 仅比较已经读验/确认的当前代；失败时仍被原blocked门禁拦住，不能假报ACK。
          if (space.entries.has(key) && JSON.stringify(encoded) === JSON.stringify(space.entries.get(key))) return value;
          entries.set(key, encoded); await commit(space, entries); return value;
        }, { write: true });
      },
      removeItem(key) { return queue(space, () => { const entries = new Map(space.entries); entries.delete(key); return commit(space, entries); }, { write: true }); },
      removeItems(keys) {
        requireValue(Array.isArray(keys) && keys.length <= 1024 && keys.every(key => typeof key === 'string' && key.length > 0 && key.length <= 512), 'invalid_key', '批量删除的记录键无效。');
        const snapshot = [...new Set(keys)];
        return queue(space, () => { const entries = new Map(space.entries); for (const key of snapshot) entries.delete(key); return commit(space, entries); }, { write: true });
      },
      clear() { return queue(space, () => commit(space, new Map()), { write: true }); },
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
    retry(name) { const space = state(name); return queue(space, () => retryWrite(space), { retry: true, write: true }); },
    async flush() {
      // 保存排空只等待写入；后台历史/缩略图读取不应拖住产品切换。
      // 同命名空间中先读后写仍按原FIFO执行，且持续纳入排空期间新入队的写操作。
      while (pendingWrites) await Promise.all([...spaces.values()].map(space => space.writeTail));
      requireValue(!errors.size && ![...spaces.values()].some(space => space.blocked), 'save_not_confirmed', '仍有未确认分片或根提交，不能报告已保存。', 409);
      return status();
    },
    close() { requireValue(!pending && !errors.size, 'save_not_confirmed', '未确认保存不能关闭客户端。'); closed = true; codec.close(); },
  };
}
