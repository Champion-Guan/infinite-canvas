// 只读取业务白名单，不恢复旧 origin 的会话、授权、租约或数据库锁。
export type LegacyBackup = {
  app: "guan-ai-workbench"; kind: "full-browser-backup"; format: 1; origin: string;
  localStorage: Record<string, string>;
  databases: Array<{ name: string; stores: Array<{ name: string; records: Array<{ key: unknown; value: unknown }> }> }>;
};
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function readLegacyBackup(value: unknown): LegacyBackup {
  if (!object(value) || value.app !== "guan-ai-workbench" || value.kind !== "full-browser-backup" || value.format !== 1 ||
      typeof value.origin !== "string" || !object(value.localStorage) || !Array.isArray(value.databases) ||
      Object.values(value.localStorage).some(item => typeof item !== "string")) throw new Error("请选择旧版完整浏览器备份 JSON，单个产品或配置文件不能代替整批备份。");
  const names = new Set<string>();
  for (const db of value.databases) {
    if (!object(db) || typeof db.name !== "string" || names.has(db.name) || !Array.isArray(db.stores)) throw new Error("备份数据库清单无效。");
    names.add(db.name);
    const stores = new Set<string>();
    for (const store of db.stores) {
      if (!object(store) || typeof store.name !== "string" || stores.has(store.name) || !Array.isArray(store.records) ||
          store.records.some(item => !object(item) || !Object.hasOwn(item, "key") || !Object.hasOwn(item, "value"))) throw new Error("备份数据分片无效。");
      stores.add(store.name);
    }
  }
  return value as LegacyBackup;
}
export function legacyRecords(backup: LegacyBackup, store: string) {
  return backup.databases.find(db => db.name === "infinite-canvas")?.stores.find(item => item.name === store)?.records ?? [];
}
export function legacyText(backup: LegacyBackup, key: string): string | null {
  const fallback = backup.localStorage[`infinite-canvas:fallback:${key}`];
  if (fallback?.startsWith("deleted:")) return null;
  const records = legacyRecords(backup, "app_state").filter(item => item.key === key);
  if (records.length > 1) throw new Error("备份存在重复应用记录，未选择任意副本覆盖。");
  // 与旧 localforage-storage 的恢复优先级相同，未确认的本地副本优先。
  const raw = backup.localStorage[key] ?? records[0]?.value;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new Error("旧应用记录不是有效的持久化文本。");
  return raw;
}
export function legacyState(backup: LegacyBackup, key: string): Record<string, unknown> | null {
  const raw = legacyText(backup, key);
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("旧应用记录损坏，未当作空数据迁移。"); }
  if (!object(parsed) || !object(parsed.state)) throw new Error("旧应用记录结构异常。");
  return parsed.state;
}
export function decodeLegacyBlob(value: unknown): Blob {
  if (!object(value) || !["blob", "file"].includes(String(value.$type)) || typeof value.base64 !== "string" ||
      typeof value.mime !== "string" || !Number.isSafeInteger(value.bytes) || (value.bytes as number) < 0) throw new Error("备份素材格式无效。");
  const encoded = value.base64;
  if (encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded)) throw new Error("备份素材编码无效。");
  const padding = encoded.indexOf("=");
  if (padding !== -1 && (padding < encoded.length - 2 || !["=", "=="].includes(encoded.slice(padding)))) throw new Error("备份素材编码无效。");
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  if (bytes.byteLength !== value.bytes) throw new Error("备份素材长度与清单不一致。");
  return new Blob([bytes], { type: value.mime });
}
