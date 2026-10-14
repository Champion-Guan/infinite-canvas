import { decodeBackupValue, encodeBackupValue } from './browser-backup-codec.mjs';

const json = value => JSON.stringify(value);
const ownKey = key => /^(guan-|guan-workbench:|infinite-canvas:|canvas-|gpt-image-playground(?:\.|$))/.test(key);
const schema = store => json({ keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes: store.indexes });

function mergeItems(source, target) {
  if (!Array.isArray(source) || !Array.isArray(target)) throw Error('画布列表格式不兼容');
  const items = new Map();
  for (const item of [...source, ...target]) {
    if (typeof item?.id !== 'string' || !item.id) throw Error('画布或资产标识无效');
    if (items.has(item.id) && json(items.get(item.id)) !== json(item)) throw Error('发现同标识的不同画布或资产，已停止合并');
    items.set(item.id, item);
  }
  return [...items.values()];
}

async function mergeState(key, source, target) {
  const a = decodeBackupValue(source), b = decodeBackupValue(target);
  if (typeof a !== 'string' || typeof b !== 'string') throw Error('画布持久化格式不兼容');
  const s = JSON.parse(a), t = JSON.parse(b);
  if (s.version !== t.version || !s.state || !t.state) throw Error('画布数据版本不兼容');
  const state = { ...t.state, ...s.state };
  if (key === 'infinite-canvas:canvas_store') {
    state.projects = mergeItems(s.state.projects, t.state.projects);
    state.deletedProjects = mergeItems(s.state.deletedProjects, t.state.deletedProjects);
    const deleted = new Set(state.deletedProjects.map(item => item.id));
    if (state.projects.some(item => deleted.has(item.id))) throw Error('画布与回收记录冲突，已停止合并');
  } else state.assets = mergeItems(s.state.assets, t.state.assets);
  return encodeBackupValue(json({ ...t, ...s, state }));
}

// Pure planning: never opens a database or writes storage. Both complete
// snapshots must already have been durably backed up by the local service.
export async function planPort3000Merge(source, target) {
  for (const [snapshot, origin] of [[source, 'http://localhost:8888'], [target, 'http://localhost:3000']]) {
    if (snapshot?.origin !== origin || snapshot.app !== 'guan-ai-workbench' || snapshot.kind !== 'full-browser-backup'
      || snapshot.format !== 1 || !Array.isArray(snapshot.databases) || !snapshot.localStorage || !snapshot.sessionStorage)
      throw Error('定向合并只允许 localhost:8888 到 localhost:3000 的完整备份');
  }
  const merged = structuredClone(target);
  const changes = { configurationConflicts: 0, mergedStates: 0, retainedCaches: 0 };
  for (const area of ['localStorage', 'sessionStorage']) {
    for (const [key, value] of Object.entries(source[area])) {
      if (typeof value !== 'string') throw Error('配置格式无效');
      if (area === 'sessionStorage' && key === '__imt_handshake_page_id') continue;
      const old = target[area][key];
      if (old !== undefined && old !== value) {
        if (!ownKey(key)) throw Error('其他项目配置发生同名冲突，已停止合并');
        changes.configurationConflicts++;
      }
      // Source workbench preferences take precedence; the old values remain
      // in the verified complete destination backup. Unrelated keys stay intact.
      Object.defineProperty(merged[area], key, { value, enumerable: true, configurable: true, writable: true });
    }
  }
  for (const db of source.databases) {
    if (!['infinite-canvas', 'gpt-image-playground', 'infinite-canvas-plugins'].includes(db.name)) throw Error('源地址存在未知数据库，已停止自动合并');
    const destination = merged.databases.find(item => item.name === db.name);
    if (!destination) { merged.databases.push(structuredClone(db)); continue; }
    if (db.version !== destination.version || db.stores.length !== destination.stores.length) throw Error('数据库版本或结构冲突');
    for (const store of db.stores) {
      const out = destination.stores.find(item => item.name === store.name);
      if (!out || schema(out) !== schema(store)) throw Error('数据库结构冲突');
      const records = new Map(out.records.map(record => [json(record.key), record]));
      for (const record of store.records) {
        const key = json(record.key), old = records.get(key);
        if (!old) { records.set(key, structuredClone(record)); continue; }
        if (json(old.value) === json(record.value)) continue;
        if (db.name === 'infinite-canvas' && store.name === 'app_state'
          && ['infinite-canvas:canvas_store', 'infinite-canvas:asset_store'].includes(record.key)) {
          records.set(key, { key: record.key, value: await mergeState(record.key, record.value, old.value) });
          changes.mergedStates++;
        } else if (db.name === 'infinite-canvas' && ['prompt_cache', 'local-forage-detect-blob-support'].includes(store.name)) {
          changes.retainedCaches++;
        } else throw Error('数据库业务记录发生同标识冲突，已停止合并');
      }
      out.records = [...records.values()];
    }
  }
  // Decode every record before admitting the first write, including media.
  for (const db of merged.databases) for (const store of db.stores) for (const record of store.records) {
    decodeBackupValue(record.key); decodeBackupValue(record.value);
  }
  return { snapshot: merged, changes };
}

// Storage order is not significant. The extension's per-page session handshake
// is intentionally excluded; all other keys, schemas and encoded bytes count.
export function comparableSnapshot(snapshot) {
  const values = area => Object.entries(snapshot[area]).filter(([key]) => area !== 'sessionStorage' || key !== '__imt_handshake_page_id').sort(([a], [b]) => a.localeCompare(b));
  return json({ origin: snapshot.origin, local: values('localStorage'), session: values('sessionStorage'),
    databases: [...snapshot.databases].sort((a, b) => a.name.localeCompare(b.name)).map(db => ({ ...db,
      stores: [...db.stores].sort((a, b) => a.name.localeCompare(b.name)).map(store => ({ ...store,
        records: [...store.records].sort((a, b) => json(a.key).localeCompare(json(b.key))) })) })) });
}
