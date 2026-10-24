import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { flushSQLiteStorage, retrySQLiteStorage, sqlitePreferences } from "../本机存储/上游浏览器存储桥";
import { productRestoreMountGate } from "../产品/产品恢复挂载门禁";
import type { AppConfigFile } from "../配置文件/配置文件安全";
import { readLegacyBackup } from "./旧版备份读取";
import { prepareLegacyProducts, mergeLegacyProducts, remapLegacyProjectChannels } from "./旧版产品转换";
import { prepareLegacySettings, mergeLegacySettings } from "./旧版配置转换";
import { prepareLegacyFallback, mergeLegacyFallback } from "./旧版故障切换转换";
import { fallbackHost, type FallbackConfig } from "../故障切换/浏览器状态";

export type LegacyTransfer = Awaited<ReturnType<typeof prepareLegacyTransfer>>;
export type TransferResult = { added: number; recycled: number; skipped: number; channels: number };
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
export async function prepareLegacyTransfer(file: File, configFile?: File) {
  if (file.size > MAX_BACKUP_BYTES) throw new Error("整批备份超过 512 MiB，请先保留原文件，联系维护者处理大文件迁移。");
  let raw: unknown, config: unknown;
  try { raw = JSON.parse(await file.text()); }
  catch { throw new Error("整批备份不是完整 JSON，请重新导出。"); }
  if (configFile) {
    if (configFile.size > 4 * 1024 * 1024) throw new Error("配置文件超过 4 MiB。");
    try { config = JSON.parse(await configFile.text()); } catch { throw new Error("补充配置文件不是有效 JSON。"); }
  }
  const backup = readLegacyBackup(raw);
  const products = await prepareLegacyProducts(backup);
  const settings = prepareLegacySettings(backup, products.sourceId, config);
  const fallback = prepareLegacyFallback(backup);
  if (Object.keys(backup.localStorage).some(key => key.startsWith("infinite-canvas:fallback:"))) products.warnings.push("旧备份存在浏览器保存恢复标记，本次按旧版读取优先级使用最新本地副本，旧备份完整保留。");
  return { products, settings, fallback, name: file.name };
}
export function currentTransferSettings(): AppConfigFile {
  const { config, webdav } = useConfigStore.getState();
  const { sources, schedule } = usePromptSourceStore.getState();
  return { app: "infinite-canvas", version: 1, exportedAt: "", config, webdav, promptSources: { sources, schedule } };
}
export function previewLegacyTransfer(plan: LegacyTransfer, useLegacyPreferences: boolean) {
  const merge = mergeLegacyProducts(useCanvasStore.getState(), plan.products.snapshot);
  const settings = mergeLegacySettings(currentTransferSettings(), plan.settings.data, plan.products.sourceId, useLegacyPreferences);
  return { added: merge.added, recycled: merge.recycled, skipped: merge.skipped, channels: settings.addedChannels, conflicts: settings.conflicts };
}
let pending: { result: TransferResult; ids: string[]; fallback: { value: FallbackConfig; revision: number } | null; fallbackSaved: boolean } | null = null;
export async function commitLegacyTransfer(plan: LegacyTransfer, useLegacyPreferences: boolean, saveCurrent: () => Promise<void>, progress: (value: string) => void, preserveMissingMedia = false) {
  if (pending) throw new Error("上次整批迁移保存尚未确认，请重试原批次，不能再次创建产品。");
  if (plan.products.missingMedia.length && !preserveMissingMedia) throw new Error("旧备份有缺失素材，请先查看缺失清单并选择是否保留缺失标记迁移。");
  await saveCurrent();
  const configBefore = useConfigStore.getState(), sourcesBefore = usePromptSourceStore.getState();
  const settings = mergeLegacySettings(currentTransferSettings(), plan.settings.data, plan.products.sourceId, useLegacyPreferences);
  const fallbackBefore = plan.fallback ? fallbackHost().snapshot() : null;
  const fallbackValue = fallbackBefore ? mergeLegacyFallback(fallbackBefore.value, plan.fallback, settings.channelIds, settings.data.config, useLegacyPreferences) : null;
  const incoming = remapLegacyProjectChannels(plan.products.snapshot, settings.channelIds);
  const before = mergeLegacyProducts(useCanvasStore.getState(), incoming);
  // 只保存这次新增产品实际引用的媒体；重复导入不再写一套素材。
  const roots = [...before.snapshot.projects.filter(item => before.ids.includes(item.id)), ...before.snapshot.deletedProjects.filter(item => before.ids.includes(item.id))];
  const serialized = JSON.stringify(roots);
  const media = plan.products.media.filter(item => serialized.includes(JSON.stringify(item.key)));
  for (let index = 0; index < media.length; index += 6) {
    progress(`正在保存素材 ${Math.min(index + 6, media.length)} / ${media.length}`);
    const results = await Promise.allSettled(media.slice(index, index + 6).map(({ key, blob }) => key.startsWith("image:") ? setImageBlob(key, blob) : setMediaBlob(key, blob)));
    if (results.some(item => item.status === "rejected")) throw new Error("素材保存失败，尚未加入产品；请通过保存状态重试后重新迁移，旧备份保留。");
  }
  await saveCurrent();
  if (configBefore.config !== useConfigStore.getState().config || configBefore.webdav !== useConfigStore.getState().webdav ||
      sourcesBefore.sources !== usePromptSourceStore.getState().sources || sourcesBefore.schedule !== usePromptSourceStore.getState().schedule) throw new Error("保存素材期间配置发生编辑，请重新预览；未覆盖现有配置。");
  const merged = mergeLegacyProducts(useCanvasStore.getState(), incoming);
  const result = { added: merged.added, recycled: merged.recycled, skipped: merged.skipped, channels: settings.addedChannels };
  if (fallbackBefore && fallbackHost().snapshot().revision !== fallbackBefore.revision) throw new Error("迁移期间 Fallback 策略被修改，请重新检查，未覆盖本机策略。");
  pending = { result, ids: merged.ids, fallback: fallbackValue && fallbackBefore ? { value: fallbackValue, revision: fallbackBefore.revision } : null, fallbackSaved: false };
  for (const id of merged.ids) productRestoreMountGate.block(id);
  useCanvasStore.setState(merged.snapshot);
  useConfigStore.setState({ config: settings.data.config, webdav: settings.data.webdav });
  usePromptSourceStore.setState({ sources: settings.data.promptSources.sources, schedule: settings.data.promptSources.schedule,
    excelSources: { ...plan.settings.excelSources, ...usePromptSourceStore.getState().excelSources } });
  for (const [key, value] of Object.entries(plan.products.preferences)) if (sqlitePreferences.getItem(key) === null) sqlitePreferences.setItem(key, value);
  progress("正在确认全部产品与配置的 SQLite 保存");
  return finishLegacyTransfer(false);
}
export async function finishLegacyTransfer(retry = true, keepCurrentFallback = false) {
  if (!pending) throw new Error("没有等待保存确认的迁移批次。");
  if (keepCurrentFallback) pending.fallback = null;
  try {
    if (retry) await retrySQLiteStorage(); await flushSQLiteStorage();
    if (pending.fallback && !pending.fallbackSaved) {
      const host = fallbackHost(), current = host.snapshot();
      if (JSON.stringify(current.value) !== JSON.stringify(pending.fallback.value)) await host.save(pending.fallback.value, pending.fallback.revision);
      pending.fallbackSaved = true;
    }
  }
  catch { throw new Error("本批产品和配置已留在页面，SQLite 保存尚未确认。请保留页面并点击“重试本批保存”，不会重复导入。"); }
  const result = pending.result;
  for (const id of pending.ids) productRestoreMountGate.release(id);
  pending = null;
  return result;
}
export function hasPendingLegacyTransfer() { return pending !== null; }
export function hasPendingLegacyFallback() { return !!pending?.fallback && !pending.fallbackSaved; }
