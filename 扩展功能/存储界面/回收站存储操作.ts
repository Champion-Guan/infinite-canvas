import { flushSQLiteStorage, retrySQLiteStorage, sqliteForage, recycleMediaIds, purgeRecycleMedia } from "../本机存储/上游浏览器存储桥";
import { collectImageStorageKeys } from "@/services/image-storage";
import { collectMediaStorageKeys } from "@/services/file-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { recycleOwnership, recycleCategory, hasActiveRecycleOwner } from "../本机存储/回收站归属.mjs";

export type RecycleStorageKind = "product_recycle" | "workbook_recycle";
type KeyGroups = Record<string, string[]>;
type Cleanup = { kind: RecycleStorageKind; ids: string[]; groups: KeyGroups; phase: "prepared" | "committed"; removed: number; targets: string[]; ownerIds: string[] };
const entryKey = (entry: { id: string; deletedAt: string }) => `${entry.id}:${entry.deletedAt}`;
const pendingKey = "guan-recycle-cleanup:v1";
let flight: Promise<unknown> | null = null;
const snapshotFor = (state: ReturnType<typeof useCanvasStore.getState>, kind: RecycleStorageKind) => kind === "product_recycle" ? state.deletedProjects : state.guanWorkbooks?.recycledWorkbooks ?? [];
const manifestStore = () => sqliteForage.createInstance({ storeName: "preferences" });

export async function pendingRecycleCleanup(): Promise<RecycleStorageKind | null> {
  return (await manifestStore().getItem<Cleanup>(pendingKey))?.kind ?? null;
}
async function finishCleanup(job: Cleanup) {
  // prepared阶段失败不得继续清媒体；保存恢复仍使用原operationId，新的编辑按原FIFO跟随。
  if (job.phase === "prepared") {
    await retrySQLiteStorage();
    await flushSQLiteStorage();
    if (snapshotFor(useCanvasStore.getState(), job.kind).some(entry => job.targets.includes(entryKey(entry)))) {
      await manifestStore().removeItem(pendingKey);
      throw new Error("上次删除未提交，回收站内容已保留，请再次点击删除。");
    }
    job = { ...job, phase: "committed" };
    await manifestStore().setItem(pendingKey, job);
  }
  const current = useCanvasStore.getState(), assets = useAssetStore.getState();
  if (!current.hydrated || !assets.hydrated) throw new Error("产品或素材尚未加载完成，暂不能继续删除。");
  const ownership = recycleOwnership(current);
  // 只重试本次已确认的所有者；新恢复的产品或另一回收站已使用的素材一律保留。
  const originalOwnership = { productIds: new Set(job.kind === "product_recycle" ? job.ownerIds : []), workbookIds: new Set(job.kind === "workbook_recycle" ? job.ownerIds : []), activeIds: new Set<string>() };
  const protectedData: unknown[] = [current.projects, current.deletedProjects, current.guanWorkbooks, assets.assets];
  const logGroups: KeyGroups = {};
  for (const storeName of ["image_generation_logs", "video_generation_logs"]) {
    const candidates = new Set(job.groups[storeName] ?? []), removable: string[] = [];
    await sqliteForage.createInstance({ storeName }).iterate<unknown, void>((row, key) => {
      if (candidates.has(key) && recycleCategory(row, originalOwnership) === job.kind && !hasActiveRecycleOwner(row, ownership)) removable.push(key);
      else protectedData.push(row);
    });
    logGroups[storeName] = removable;
  }
  const protectedImages = collectImageStorageKeys(protectedData), protectedMedia = collectMediaStorageKeys(protectedData);
  const groups = { ...job.groups, ...logGroups };
  let liveCanvas = current, liveAssets = assets.assets;
  let liveImages = collectImageStorageKeys(protectedData), liveMedia = collectMediaStorageKeys(protectedData);
  for (const [storeName, keys] of Object.entries(groups)) {
    const store = sqliteForage.createInstance({ storeName });
    for (let start = 0; start < keys.length; start += 256) {
      const removable: string[] = [];
      for (const key of keys.slice(start, start + 256)) {
        // 异步删除期间重新核对内存引用，不能因重试覆盖后来恢复/新增的内容。
        const latest = useCanvasStore.getState(), latestAssets = useAssetStore.getState().assets;
        if (latest !== liveCanvas || latestAssets !== liveAssets) {
          liveCanvas = latest; liveAssets = latestAssets;
          const data = [latest.projects, latest.deletedProjects, latest.guanWorkbooks, latestAssets];
          liveImages = collectImageStorageKeys(data); liveMedia = collectMediaStorageKeys(data);
        }
        if (storeName === "image_files" || storeName === "image_previews") {
          if (protectedImages.has(key) || liveImages.has(key)) continue;
        } else if (storeName === "media_files") {
          if (protectedMedia.has(key) || liveMedia.has(key)) continue;
        } else {
          const row = await store.getItem(key);
          if (hasActiveRecycleOwner(row, recycleOwnership(useCanvasStore.getState()))) continue;
        }
        removable.push(key);
      }
      // 同一批只发布一次索引，避免逐文件保存把删除变成大量历史分片写入。
      if (removable.length) await store.removeItems(removable);
    }
  }
  await flushSQLiteStorage();
  let deferred: string[] = [];
  for (let offset = 0; offset < job.ids.length; offset += 512) {
    const result = await purgeRecycleMedia(job.ids.slice(offset, offset + 512));
    deferred.push(...result.deferred);
  }
  if (deferred.length) {
    await manifestStore().setItem(pendingKey, { ...job, groups: {}, ids: deferred });
    return { removed: job.removed, pending: true };
  }
  await manifestStore().removeItem(pendingKey);
  await flushSQLiteStorage();
  return { removed: job.removed, pending: false };
}

async function clear(kind: RecycleStorageKind) {
  // 无论上次在哪个阶段中断，都先恢复原保存队列，再读取清单和继续清理。
  await retrySQLiteStorage();
  await flushSQLiteStorage();
  const pending = await manifestStore().getItem<Cleanup>(pendingKey);
  if (pending) {
    if (pending.kind !== kind) throw new Error("另一类回收站仍有删除待完成，请先点击其“重试删除”。");
    return finishCleanup(pending);
  }
  await flushSQLiteStorage();
  const before = useCanvasStore.getState(), assetState = useAssetStore.getState();
  if (!before.hydrated || !assetState.hydrated) throw new Error("产品或素材尚未加载完成，暂不能清理回收站。");
  const snapshot = snapshotFor(before, kind);
  if (!snapshot.length) return { removed: 0, pending: false };
  const ownership = recycleOwnership(before);
  const images = collectImageStorageKeys(snapshot), media = collectMediaStorageKeys(snapshot);
  const removedAssets = assetState.assets.filter(asset => recycleCategory(asset, ownership) === kind);
  collectImageStorageKeys(removedAssets, images); collectMediaStorageKeys(removedAssets, media);
  const keptAssets = assetState.assets.filter(asset => !removedAssets.includes(asset));
  const nextBooks = before.guanWorkbooks ? { ...before.guanWorkbooks, contract: { ...before.guanWorkbooks.contract } } : null;
  if (nextBooks) for (const [key, rows] of Object.entries(nextBooks.contract)) if (Array.isArray(rows)) {
    // productSets保留仍在使用的工作簿；关联产品、任务及产物仅移除明确归属于本次回收站的记录。
    if (key === "productSets") continue;
    const removed = rows.filter(row => recycleCategory(row, ownership) === kind);
    collectImageStorageKeys(removed, images); collectMediaStorageKeys(removed, media);
    (nextBooks.contract as unknown as Record<string, unknown>)[key] = rows.filter(row => !removed.includes(row));
  }
  if (kind === "workbook_recycle" && nextBooks) nextBooks.recycledWorkbooks = [];
  const nextDeleted = kind === "product_recycle" ? [] : before.deletedProjects;
  const protectedData = [before.projects, nextDeleted, nextBooks, keptAssets];
  const protectedImages = collectImageStorageKeys(protectedData), protectedMedia = collectMediaStorageKeys(protectedData);
  const groups: KeyGroups = {};
  for (const storeName of ["image_generation_logs", "video_generation_logs"]) {
    const keys: string[] = [];
    await sqliteForage.createInstance({ storeName }).iterate<unknown, void>((row, key) => {
      if (recycleCategory(row, ownership) === kind) { keys.push(key); collectImageStorageKeys(row, images); collectMediaStorageKeys(row, media); }
      else { collectImageStorageKeys(row, protectedImages); collectMediaStorageKeys(row, protectedMedia); }
    });
    groups[storeName] = keys;
  }
  for (const key of protectedImages) images.delete(key);
  for (const key of protectedMedia) media.delete(key);
  for (const key of images) media.delete(key);
  groups.image_files = [...images]; groups.image_previews = [...images]; groups.media_files = [...media];
  const ids = await recycleMediaIds({ ...groups, app_state: ["infinite-canvas:canvas_store", "infinite-canvas:asset_store"] });
  // 最后一次异步扫描后复核对象身份；任何恢复/编辑都让用户重新点击，不覆盖并发变更。
  const unchanged = () => {
    const now = useCanvasStore.getState();
    return now.projects === before.projects && now.deletedProjects === before.deletedProjects && now.guanWorkbooks === before.guanWorkbooks && useAssetStore.getState().assets === assetState.assets;
  };
  if (!unchanged()) throw new Error("扫描期间产品或素材发生变化，请重新点击删除。");
  const job: Cleanup = { kind, ids, groups, phase: "prepared", removed: snapshot.length, targets: snapshot.map(entryKey), ownerIds: [...(kind === "product_recycle" ? ownership.productIds : ownership.workbookIds)] };
  await manifestStore().setItem(pendingKey, job);
  if (!unchanged()) { await manifestStore().removeItem(pendingKey); throw new Error("扫描期间产品或素材发生变化，请重新点击删除。"); }
  // 同步提交内存改动后立即进入原保存队列；失败保留明确的清理清单，绝不全量回滚覆盖新编辑。
  useCanvasStore.setState({ deletedProjects: nextDeleted, guanWorkbooks: nextBooks });
  if (removedAssets.length) useAssetStore.getState().replaceAssets(keptAssets);
  await flushSQLiteStorage();
  await manifestStore().setItem(pendingKey, { ...job, phase: "committed" });
  return finishCleanup({ ...job, phase: "committed" });
}
export async function clearRecycleStorage(kind: RecycleStorageKind): Promise<{ removed: number; pending: boolean }> {
  if (flight) throw new Error("回收站正在删除，请等待完成。");
  const operation = clear(kind); flight = operation;
  try { return await operation; } finally { flight = null; }
}
