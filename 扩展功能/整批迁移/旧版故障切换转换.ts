// 旧四类故障切换配置只转换策略数据，不迁移运行中的请求。
import { normalizeFallback, reconcileFallback } from "../故障切换/原版策略.mjs";
import { validModelOrder } from "../故障切换/模型默认排序.mjs";
import type { FallbackConfig } from "../故障切换/浏览器状态";
import type { AiConfig } from "@/stores/use-config-store";
import { object, type LegacyBackup } from "./旧版备份读取";

const capabilities = ["image", "video", "text", "audio"] as const;
export function prepareLegacyFallback(backup: LegacyBackup): FallbackConfig | null {
  const raw = backup.localStorage["infinite-canvas:channel-fallback-v2"] ?? backup.localStorage["infinite-canvas:channel-fallback"];
  if (raw === undefined) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("旧 Fallback 配置损坏，未当成默认排序迁移。"); }
  if (value === null) return null;
  if (!object(value)) throw new Error("旧 Fallback 配置格式异常。");
  const groups = object(value.capabilities) ? value.capabilities : { image: value };
  for (const capability of capabilities) {
    const group = groups[capability];
    if (group === undefined || group === null) continue;
    if (!object(group) || typeof group.enabled !== "boolean" || !Array.isArray(group.entries) ||
        group.entries.some(entry => !object(entry) || typeof entry.profileId !== "string" || (entry.modelName !== undefined && typeof entry.modelName !== "string") || typeof entry.enabled !== "boolean") ||
        (group.modelOrder !== undefined && !validModelOrder(group.modelOrder))) throw new Error("旧 Fallback 分组、条目或模型排序格式异常。");
  }
  return normalizeFallback(groups) as FallbackConfig;
}
export function mergeLegacyFallback(current: FallbackConfig, old: FallbackConfig | null, channelIds: Map<string, string>, config: AiConfig, preferLegacy: boolean): FallbackConfig | null {
  if (!old) return null;
  const groups = structuredClone(current.capabilities);
  for (const key of capabilities) {
    const existing = groups[key];
    const incoming = old.capabilities[key];
    const entries = incoming.entries.map(entry => ({ ...entry, profileId: channelIds.get(entry.profileId) ?? entry.profileId, modelName: entry.modelName || "" }));
    if (preferLegacy) groups[key] = { ...incoming, entries };
    else {
      const known = new Set(existing.entries.map(entry => `${entry.profileId}::${entry.modelName}`));
      existing.entries.push(...entries.filter(entry => !known.has(`${entry.profileId}::${entry.modelName}`)).map(entry => ({ ...entry, enabled: false })));
    }
  }
  // 兼容旧的仅渠道条目；按该渠道当前真实模型展开后再核对能力和顺序。
  // 核对结果含界面展示用的渠道和模型对象；保存时只保留策略白名单字段。
  return normalizeFallback(reconcileFallback(normalizeFallback(groups), config.channels).capabilities) as FallbackConfig;
}
