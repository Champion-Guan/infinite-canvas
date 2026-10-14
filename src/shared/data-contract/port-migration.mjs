import { encodeBackupValue, decodeBackupValue } from './browser-backup-codec.mjs';
import { planPort3000Merge, comparableSnapshot } from './port3000-merge.mjs';
const result = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(Error('浏览器数据库操作失败'));
});
const committed = tx => new Promise((resolve, reject) => {
  tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(Error('浏览器数据保存失败'));
});
const storage = value => Object.fromEntries(Array.from({ length: value.length }, (_, i) => {
  const key = value.key(i); return [key, value.getItem(key)];
}));
// Immersive Translate creates a per-page handshake even on a blank Origin.
// Keep the destination handshake; it is extension state, not workbench data.
const transientSessionKey = '__imt_handshake_page_id';
// Only automatic defaults created after the v1.0.21 empty iframe copy.
// The caller must first save/read back the destination and prove that old copy
// was empty. No canvas, configuration, workbook or database is admitted here.
export function isEmptyAliasCopyDefaults(values) {
  if (values['guan-localhost-copy-v1'] !== 'verified') return false;
  try { return Object.entries(values).every(([key, value]) => {
    if (key === 'guan-localhost-copy-v1') return value === 'verified';
    if (key === 'guan-workbench-theme') return ['light', 'dark'].includes(value);
    if (key === 'molili_device_id') return /^[a-f0-9-]{36}$/i.test(value);
    const item = JSON.parse(value);
    if (key === 'infinite-canvas:theme_store') return JSON.stringify(item) === JSON.stringify({state:{theme:'light'}})
      || JSON.stringify(item) === JSON.stringify({state:{theme:'dark'}});
    if (key === 'pixpix:session-sync') return Object.keys(item).sort().join(',') === 'at,status' && typeof item.at === 'number' && ['guest', 'anonymous', 'signed-out', 'unauthenticated'].includes(item.status);
    if (key === 'pixpix:first-external-source:v1') return Object.keys(item).sort().join(',') === 'capturedAt,firstLandingPath,firstLandingUrl,firstSource,firstSourceType'
      && item.firstLandingPath === '/' && item.firstLandingUrl === 'http://localhost:8888/'
      && typeof item.capturedAt === 'string' && Number.isFinite(Date.parse(item.capturedAt))
      && item.firstSource === 'direct' && item.firstSourceType === 'direct';
    return false;
  }); } catch { return false; }
}
// Read-only source export, including Blob bytes, schemas and indexes.
export async function exportBrowserStorage() {
  const snapshot = { app: 'guan-ai-workbench', kind: 'full-browser-backup', format: 1,
    origin: location.origin, localStorage: storage(localStorage), sessionStorage: storage(sessionStorage), databases: [] };
  for (const info of await indexedDB.databases()) {
    const db = await result(indexedDB.open(info.name, info.version));
    try {
      const spec = { name: db.name, version: db.version, stores: [] };
      for (const name of db.objectStoreNames) {
        const tx = db.transaction(name, 'readonly'), store = tx.objectStore(name);
        const schema = { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
          indexes: Array.from(store.indexNames, index => { const s = store.index(index); return { name: s.name, keyPath: s.keyPath, unique: s.unique, multiEntry: s.multiEntry }; }) };
        const keysRequest = store.getAllKeys(), valuesRequest = store.getAll();
        const [keys, values] = await Promise.all([result(keysRequest), result(valuesRequest)]);
        const records = [];
        for (let i = 0; i < keys.length; i++) records.push({ key: await encodeBackupValue(keys[i]), value: await encodeBackupValue(values[i]) });
        spec.stores.push({ ...schema, records });
      }
      snapshot.databases.push(spec);
    } finally { db.close(); }
  }
  if (JSON.stringify(snapshot.localStorage) !== JSON.stringify(storage(localStorage))) throw Error('源配置仍在变化，请保存并关闭工作台页面后重试');
  return snapshot;
}
// No clear/delete/put. Original source is retained; an occupied target is refused.
export async function restoreBrowserStorage(snapshot, { recoverEmptyAliasCopy = false, mergeTargetBackup } = {}) {
  const target = new URL(location.origin);
  const localAliasCopy = target.protocol === 'http:' && target.hostname === 'localhost'
    && Number(target.port) >= 1024 && snapshot?.origin === `http://127.0.0.1:${target.port}`;
  const legacyPortCopy = location.origin === 'http://127.0.0.1:8888' && snapshot?.origin === 'http://127.0.0.1:5174';
  const port3000Copy = location.origin === 'http://localhost:3000' && snapshot?.origin === 'http://localhost:8888';
  if ((!legacyPortCopy && !localAliasCopy && !port3000Copy) || snapshot?.app !== 'guan-ai-workbench'
    || snapshot.kind !== 'full-browser-backup' || snapshot.format !== 1
    || !Array.isArray(snapshot.databases) || !snapshot.localStorage || !snapshot.sessionStorage) throw Error('迁移地址或备份格式不匹配');
  if (mergeTargetBackup) {
    if (!port3000Copy) throw Error('定向合并地址不匹配');
    return restoreMergedStorage(snapshot, mergeTargetBackup);
  }
  const localValues = storage(localStorage);
  const recoverDefaults = localAliasCopy && recoverEmptyAliasCopy && isEmptyAliasCopyDefaults(localValues);
  const occupiedLocal = !recoverDefaults && Object.entries(localValues).some(([key, value]) =>
    !(localAliasCopy && key === 'guan-localhost-copy-v1' && value === 'verified'));
  if (occupiedLocal || Object.keys(storage(sessionStorage)).some(key => key !== transientSessionKey)
    || (await indexedDB.databases()).length) throw Error('新地址已有数据，已停止迁移，未覆盖任何数据');
  // Validate/decode before the first destination write.
  const decoded = snapshot.databases.map(spec => ({ ...spec, stores: spec.stores.map(store => ({ ...store,
    records: store.records.map(record => ({ key: decodeBackupValue(record.key), value: decodeBackupValue(record.value) })) })) }));
  for (const name of ['localStorage', 'sessionStorage']) for (const value of Object.values(snapshot[name]))
    if (typeof value !== 'string') throw Error('备份配置格式无效');
  try {
    for (const spec of decoded) {
      const request = indexedDB.open(spec.name, spec.version);
      request.onupgradeneeded = () => {
        for (const store of spec.stores) {
          const created = request.result.createObjectStore(store.name, { keyPath: store.keyPath, autoIncrement: store.autoIncrement });
          for (const index of store.indexes) created.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
        }
      };
      const db = await result(request);
      try {
        for (const store of spec.stores) {
          const tx = db.transaction(store.name, 'readwrite'), done = committed(tx), target = tx.objectStore(store.name);
          for (const record of store.records) {
            if (store.keyPath === null) target.add(record.value, record.key); else target.add(record.value);
          }
          await done;
          const read = db.transaction(store.name, 'readonly').objectStore(store.name);
          const keysRequest = read.getAllKeys(), valuesRequest = read.getAll();
          const [keys, values] = await Promise.all([result(keysRequest), result(valuesRequest)]);
          if (keys.length !== store.records.length) throw Error('数据库记录数量不一致');
          const expected = new Map();
          for (const record of store.records) expected.set(JSON.stringify(await encodeBackupValue(record.key)), JSON.stringify(await encodeBackupValue(record.value)));
          for (let i = 0; i < keys.length; i++) if (expected.get(JSON.stringify(await encodeBackupValue(keys[i]))) !== JSON.stringify(await encodeBackupValue(values[i])))
            throw Error('数据库内容校验失败');
        }
      } finally { db.close(); }
    }
    for (const [name, target] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) {
      const entries = Object.entries(snapshot[name]).filter(([key]) => name !== 'sessionStorage' || key !== transientSessionKey);
      for (const [key, value] of entries) target.setItem(key, value);
      for (const [key, value] of entries) if (target.getItem(key) !== value) throw Error('配置内容校验失败');
    }
    return { verified: true, databases: decoded.length };
  } catch { throw Error('迁移未通过，已保留原地址和备份；新地址的部分副本也保留，请勿打开工作台或覆盖数据'); }
}

async function restoreMergedStorage(source, targetBackup) {
  const { snapshot: merged, changes } = await planPort3000Merge(source, targetBackup);
  if (comparableSnapshot(await exportBrowserStorage()) !== comparableSnapshot(targetBackup))
    throw Error('目标数据在备份后发生变化，已停止合并');
  // Decode all data before the first write. Only changed records are put;
  // no database, object store or record is cleared/deleted.
  const decoded = merged.databases.map(db => ({ ...db, stores: db.stores.map(store => ({ ...store,
    records: store.records.map(record => ({ encoded: record, key: decodeBackupValue(record.key), value: decodeBackupValue(record.value) })) })) }));
  try {
    for (const spec of decoded) {
      const original = targetBackup.databases.find(db => db.name === spec.name);
      const modified = spec.stores.filter(store => {
        const before = original?.stores.find(item => item.name === store.name);
        return !before || JSON.stringify(store.records.map(record => record.encoded)) !== JSON.stringify(before.records);
      });
      if (!modified.length) continue;
      const request = indexedDB.open(spec.name, spec.version);
      request.onupgradeneeded = () => {
        if (original) { request.transaction.abort(); return; }
        for (const store of spec.stores) {
          const created = request.result.createObjectStore(store.name, { keyPath: store.keyPath, autoIncrement: store.autoIncrement });
          for (const index of store.indexes) created.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
        }
      };
      request.onblocked = () => { /* No forced closure or deletion of another site's database. */ };
      const db = await result(request);
      try {
        const tx = db.transaction(modified.map(store => store.name), 'readwrite'), done = committed(tx);
        for (const store of modified) {
          const previous = new Map((original?.stores.find(item => item.name === store.name)?.records || []).map(record => [JSON.stringify(record.key), JSON.stringify(record.value)]));
          const out = tx.objectStore(store.name);
          for (const record of store.records) {
            if (previous.get(JSON.stringify(record.encoded.key)) === JSON.stringify(record.encoded.value)) continue;
            if (store.keyPath === null) out.put(record.value, record.key); else out.put(record.value);
          }
        }
        await done;
      } finally { db.close(); }
    }
    for (const [area, out] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]])
      for (const [key, value] of Object.entries(merged[area])) {
        if (area === 'sessionStorage' && key === transientSessionKey) continue;
        if (out.getItem(key) !== value) out.setItem(key, value);
      }
    if (comparableSnapshot(await exportBrowserStorage()) !== comparableSnapshot(merged)) throw Error('合并内容逐项校验失败');
    return { verified: true, databases: decoded.length, changes };
  } catch { throw Error('合并未通过，两份完整备份及旧地址保留；请勿打开工作台或反复覆盖'); }
}
