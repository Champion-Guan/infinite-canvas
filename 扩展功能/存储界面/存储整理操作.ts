import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { flushSQLiteStorage, storageStatus } from "../本机存储/上游浏览器存储桥";
import { clearRecycleStorage, pendingRecycleCleanup, type RecycleStorageKind } from "./回收站存储操作";
import { collectRecordIds } from "../本机存储/回收站归属.mjs";

export type RetentionPolicy = { enabled: boolean; days: number };
export type CleanupResult = { completedAt: number; automatic: boolean; bytes: number; fragments: number; media: number; tasks: number; recycled?: number };
export type MaintenanceStatus = { policy: RetentionPolicy; lastRun: CleanupResult | null; lastAutomaticAt: number | null; running: boolean; protectedOwners: string[]; reusableBytes: number; generationRunning: number };
type ServerPlan = { id: string; mode: "expired" | "organize"; expiresAt: number; bytes: number; fragmentBytes: number; mediaBytes: number; taskBytes: number;
  fragments: number; media: number; tasks: number; waiting: number; protectedTasks: number; protectedOwners: string[]; retentionDays: number };
export type CleanupPreview = ServerPlan & { recycled: number };
type LocalPlan = { preview: CleanupPreview; targets: Record<RecycleStorageKind, string[]>; canvas: ReturnType<typeof useCanvasStore.getState>; assets: unknown };
let localPlan: LocalPlan | null = null, flight = false, scanning = false, automaticError = "";
const day = 86_400_000;
async function command<T>(input: unknown): Promise<T> {
  const host = window.__guanSQLiteHost as typeof window.__guanSQLiteHost & { storageMaintenance?: (input: unknown) => Promise<T> };
  if (!host?.storageMaintenance) throw new Error("当前服务尚未支持存储整理，请重启工作台后重试。");
  return host.storageMaintenance(input);
}
export async function readMaintenanceStatus() {
  const status = await command<MaintenanceStatus>({ operation: "status" });
  return { ...status, automaticError };
}
export function saveRetentionPolicy(policy: RetentionPolicy) {
  localPlan = null;
  return command<MaintenanceStatus>({ operation: "configure", policy });
}
export async function compactStorage() {
  if (flight || scanning) throw new Error("存储整理正在进行，请等待完成。");
  flight = true;
  try {
    await flushSQLiteStorage();
    return await command<{ bytes: number; completedAt: number }>({ operation: "compact" });
  } finally { flight = false; }
}
function currentSnapshot() {
  const canvas = useCanvasStore.getState(), assets = useAssetStore.getState();
  if (!canvas.hydrated || !assets.hydrated) throw new Error("画布和素材仍在加载，请稍后整理。");
  return { canvas, assets: assets.assets };
}
function unchanged(plan: Pick<LocalPlan, "canvas" | "assets">) {
  const current = currentSnapshot();
  return current.canvas.projects === plan.canvas.projects && current.canvas.deletedProjects === plan.canvas.deletedProjects &&
    current.canvas.guanWorkbooks === plan.canvas.guanWorkbooks && current.assets === plan.assets;
}
async function preview(mode: ServerPlan["mode"], automatic: boolean): Promise<CleanupPreview> {
  if (flight) throw new Error("存储整理正在执行，请等待完成。");
  if (await pendingRecycleCleanup()) throw new Error("上次回收站删除尚未完成，请先在对应回收站点击“重试删除”。");
  await flushSQLiteStorage();
  const snapshot = currentSnapshot();
  const server = await command<ServerPlan>({ operation: "preview", mode, automatic });
  const cutoff = Date.now() - server.retentionDays * day, protectedOwners = new Set(server.protectedOwners);
  const eligible = (entry: { id: string; deletedAt: string }) => {
    const time = Date.parse(entry.deletedAt);
    return Number.isFinite(time) && time <= cutoff && ![...collectRecordIds(entry)].some(id => protectedOwners.has(id));
  };
  const key = (entry: { id: string; deletedAt: string }) => `${entry.id}:${entry.deletedAt}`;
  const targets = {
    product_recycle: snapshot.canvas.deletedProjects.filter(eligible).map(key),
    workbook_recycle: (snapshot.canvas.guanWorkbooks?.recycledWorkbooks || []).filter(eligible).map(key),
  };
  if (!unchanged(snapshot)) throw new Error("扫描期间画布或素材发生变化，请重新扫描。");
  const preview = { ...server, recycled: targets.product_recycle.length + targets.workbook_recycle.length };
  localPlan = { ...snapshot, targets, preview };
  return preview;
}
export async function previewStorageCleanup(mode: ServerPlan["mode"], automatic = false): Promise<CleanupPreview> {
  if (scanning) throw new Error("正在扫描存储内容，请稍候。");
  scanning = true;
  try { return await preview(mode, automatic); } finally { scanning = false; }
}
export async function executeStorageCleanup(id: string): Promise<CleanupResult> {
  if (flight) throw new Error("存储整理正在执行，请等待完成。");
  const plan = localPlan;
  if (!plan || plan.preview.id !== id || plan.preview.expiresAt < Date.now()) throw new Error("整理预览已过期，请重新扫描。");
  flight = true;
  try {
    await flushSQLiteStorage();
    if (!unchanged(plan)) throw new Error("扫描后画布或素材发生变化，请重新扫描。");
    const result = await command<CleanupResult>({ operation: "execute", id });
    let recycled = 0;
    try {
      const current = await readMaintenanceStatus(), protectedOwners = new Set(current.protectedOwners);
      if (current.policy.days !== plan.preview.retentionDays) throw new Error("保留期限已改变，请重新扫描回收记录。");
      for (const kind of ["product_recycle", "workbook_recycle"] as const) {
        const state = currentSnapshot().canvas;
        const entries = kind === "product_recycle" ? state.deletedProjects : state.guanWorkbooks?.recycledWorkbooks || [];
        const targets = plan.targets[kind].filter(target => entries.some(entry => `${entry.id}:${entry.deletedAt}` === target &&
          ![...collectRecordIds(entry)].some(owner => protectedOwners.has(owner))));
        if (targets.length) {
          const cleared = await clearRecycleStorage(kind, targets);
          recycled += cleared.removed;
          if (cleared.pending) throw new Error("回收记录已清理，刚上传的媒体仍在等待保存，请稍后在回收站重试删除。");
        }
      }
    } catch (error) {
      throw new Error(`已完成部分整理（${result.fragments} 条旧版保存记录、${result.tasks} 份已保存结果的恢复文件）；${error instanceof Error ? error.message : "回收站清理未完成。"}`);
    }
    automaticError = "";
    return { ...result, recycled };
  } finally { localPlan = null; flight = false; }
}

// 工作台关闭期间不运行；恢复打开后在可见、空闲且保存完成时补做当天检查。
export function startAutomaticStorageCleanup() {
  let disposed = false, checking = false, lastInteraction = Date.now(), nextCheck = Date.now() + 60_000;
  const interact = () => { lastInteraction = Date.now(); };
  const tick = async () => {
    if (disposed || checking || flight || Date.now() < nextCheck || document.visibilityState !== "visible" || Date.now() - lastInteraction < 10_000) return;
    const storage = storageStatus();
    if (storage.state === "saving" || storage.state === "error" || storage.pending) return;
    checking = true;
    try {
      currentSnapshot();
      const status = await readMaintenanceStatus();
      nextCheck = Date.now() + 60 * 60_000;
      if (!status.policy.enabled || status.running || status.generationRunning || status.lastAutomaticAt && Date.now() - status.lastAutomaticAt < day || disposed) return;
      // 生成尚在进行时延后；已落盘待恢复的任务由服务端持续保护。
      const plan = await previewStorageCleanup("expired", true);
      if (!disposed && Date.now() - lastInteraction >= 10_000 && document.visibilityState === "visible") await executeStorageCleanup(plan.id);
    } catch (error) { automaticError = error instanceof Error ? error.message : "自动整理未完成。"; nextCheck = Date.now() + 60 * 60_000; }
    finally { checking = false; }
  };
  document.addEventListener("pointerdown", interact, { passive: true });
  document.addEventListener("keydown", interact);
  const timer = window.setInterval(() => void tick(), 60_000);
  return () => { disposed = true; window.clearInterval(timer); document.removeEventListener("pointerdown", interact); document.removeEventListener("keydown", interact); };
}
