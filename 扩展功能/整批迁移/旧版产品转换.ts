import { decompressSync, strFromU8 } from "fflate";
import type { CanvasProject, CanvasDeletedProject } from "@/stores/canvas/use-canvas-store";
import { prepareCanvasExport } from "../画布导入/画布导入数据";
import { assertWorkbookSnapshot, type WorkbookContract, type WorkbookSnapshot, type ExcelWorkbooks } from "../Excel/Excel产品归属";
import { productDisplayName } from "../产品/旧版产品显示名.js";
import { decodeLegacyBlob, legacyRecords, legacyState, legacyText, object, type LegacyBackup } from "./旧版备份读取";
import { normalizeLegacyMediaReferences } from "./旧版媒体引用归一";
import { imageInfoDefaults } from "../图片设置/图片信息偏好";

const fields = new Set(["storageKey", "originalStorageKey", "deliveryStorageKey", "references"]);
export function legacyJSON(raw: string | undefined | null, empty: unknown): unknown {
  if (raw == null) return empty;
  try {
    const prefix = "guan-workbench-compressed-v1:";
    return JSON.parse(raw.startsWith(prefix) ? strFromU8(decompressSync(Uint8Array.from(atob(raw.slice(prefix.length)), char => char.charCodeAt(0)))) : raw);
  } catch { throw new Error("旧版产品或工作簿记录损坏，未以空数据代替。"); }
}
function list(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(item => !object(item))) throw new Error(`${label}格式异常。`);
  return value as Record<string, unknown>[];
}
function unique(items: Record<string, unknown>[], label: string) {
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item.id !== "string" || !item.id || seen.has(item.id)) throw new Error(`${label}编号缺失或重复。`);
    seen.add(item.id);
  }
}
function storedDate(value: unknown, fallback: string) {
  if (value === undefined || value === null) return fallback;
  if ((typeof value !== "string" && typeof value !== "number") || !Number.isFinite(new Date(value).getTime())) throw new Error("旧产品时间无效。");
  return new Date(value).toISOString();
}
export type LegacyProducts = {
  snapshot: WorkbookSnapshot; media: Array<{ key: string; blob: Blob }>;
  preferences: Record<string, string>; warnings: string[]; sourceId: string;
  missingMedia: Array<{ key: string; product: string; replacement: string }>;
};
export async function prepareLegacyProducts(backup: LegacyBackup): Promise<LegacyProducts> {
  const persisted = legacyState(backup, "infinite-canvas:canvas_store");
  const native = list(persisted?.projects ?? [], "旧画布"); unique(native, "旧画布");
  const contractRaw = legacyJSON(backup.localStorage["guan-workbench:data-contract:v1"], null);
  if (contractRaw !== null && (!object(contractRaw) || contractRaw.schema !== "guan-workbench.v1" || !object(contractRaw.workspace))) throw new Error("旧版 Excel 合同无效。");
  const contract = contractRaw as WorkbookContract | null;
  const products = list(contract?.products ?? [], "旧产品"); unique(products, "旧产品");
  const extras = list(legacyJSON(backup.localStorage["guan-header-canvas-projects"], []), "独立产品"); unique(extras, "独立产品");
  const trash = list(legacyJSON(backup.localStorage["guan-product-recycle-bin:v1"], []), "产品回收站");
  const sourceBytes = new TextEncoder().encode(String((contract?.workspace as Record<string, unknown> | undefined)?.id ?? backup.origin));
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", sourceBytes))].map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
  const sourceId = `legacy_${digest}`;
  const mappedId = (id: string) => `${sourceId}_${id}`;
  const claimed = new Set<string>(), warnings: string[] = [], preferences: Record<string, string> = {};
  const projects: CanvasProject[] = [], deletedProjects: CanvasDeletedProject[] = [];
  const byId = new Map(native.map(project => [String(project.id), project]));
  const owner = contract?.workspace.activeProductSetId ?? null;
  const now = new Date().toISOString();
  const toProject = (item: Record<string, unknown>, archived?: Record<string, unknown>, forcedCanvasId?: string): CanvasProject => {
    const originalId = String(item.id), id = mappedId(originalId);
    const title = backup.localStorage[`guan-canvas-title:${originalId}`] || productDisplayName(item, Number(item.order ?? 1) - 1);
    const route = backup.localStorage[`guan-native-canvas-route:${originalId}`];
    const routeId = forcedCanvasId ?? route?.match(/^\/canvas\/([A-Za-z0-9_-]+)$/)?.[1];
    let canvas = archived ?? byId.get(routeId ?? originalId);
    if (!canvas && routeId) throw new Error("旧产品的画布映射缺失，请保留旧版数据，不能迁成空画布。");
    if (!canvas) {
      const candidates = native.filter(project => project.title === title && !claimed.has(String(project.id)));
      if (candidates.length > 1) throw new Error("存在多个同名旧画布且缺少明确映射，未猜测产品归属。");
      canvas = candidates[0];
    }
    if (canvas) claimed.add(String(canvas.id));
    const memory = backup.localStorage[`guan-canvas-parameter-values:${encodeURIComponent(originalId)}`];
    if (memory !== undefined) {
      const values = legacyJSON(memory, {});
      if (!object(values) || Object.values(values).some(value => typeof value !== "string")) throw new Error("旧产品参数记忆格式异常。");
      preferences[`guan-canvas-parameter-values:${encodeURIComponent(id)}`] = JSON.stringify(values);
    }
    const rawOwner = Object.hasOwn(item, "productSetId") ? item.productSetId : owner;
    return { createdAt: storedDate(item.createdAt, now), updatedAt: storedDate(item.updatedAt, now), nodes: [], connections: [], chatSessions: [], activeChatId: null,
      backgroundMode: "lines", ...imageInfoDefaults, viewport: { x: 0, y: 0, k: 1 }, ...canvas,
      id, title: canvas ? String(canvas.title) : title, productSetId: rawOwner ? mappedId(String(rawOwner)) : null } as CanvasProject;
  };
  const liveIds = new Set<string>();
  for (const product of [...products, ...extras]) {
    if (liveIds.has(String(product.id))) throw new Error("旧版产品与独立画布编号冲突。");
    liveIds.add(String(product.id)); projects.push(toProject(product));
  }
  for (const entry of trash) {
    if (entry.ready !== true || typeof entry.productId !== "string" || typeof entry.projectId !== "string" || typeof entry.id !== "string") throw new Error("旧产品回收尚未完成，请在旧版确认后再整批迁移。");
    const raw = legacyText(backup, `infinite-canvas:product-recycle:${entry.id}`);
    const archive = legacyJSON(raw, null);
    if (!object(archive) || !object(archive.project)) throw new Error("旧回收站缺少恢复快照，迁移已停止。");
    if (archive.project.id !== entry.projectId) throw new Error("旧回收站的产品和画布快照不匹配。");
    const item = object(entry.contract) && object(entry.contract.product) ? entry.contract.product : object(entry.standalone) ? entry.standalone : { id: entry.productId, title: entry.name, productSetId: null };
    const project = toProject(item, archive.project, entry.projectId);
    deletedProjects.push({ id: project.id, project, deletedAt: String(entry.deletedAt) });
  }
  const nativeDeleted = list(persisted?.deletedProjects ?? [], "原生画布回收记录");
  for (const item of native) {
    if (claimed.has(String(item.id)) || backup.localStorage[`guan-product-recycled-canvas:${item.id}`] === "deleted") continue;
    // 不丢弃未显示在旧顶栏的独立画布。
    const project = toProject({ ...item, productSetId: null }, item);
    if (liveIds.has(String(item.id))) throw new Error("旧版画布编号冲突。");
    liveIds.add(String(item.id)); projects.push(project);
  }
  const roots = [...projects, ...deletedProjects.flatMap(item => item.project ? [item.project] : [])];
  unique(roots, "迁移画布");
  for (const project of projects) if (project.nodes.some(node => node.metadata?.status === "loading" ||
      node.metadata?.images?.some(image => image.status === "loading"))) throw new Error(`旧产品“${project.title}”仍有进行中或待核实的生成任务，请在旧版确认结束后重新备份；本次未重发任务。`);
  if (!roots.length && !contract?.productSets.length) throw new Error("备份中没有可迁移的产品或工作簿，请检查旧版浏览器及地址。");
  const blobs = new Map<string, Blob>();
  for (const store of ["image_files", "media_files"]) for (const record of legacyRecords(backup, store)) {
    if (typeof record.key !== "string" || blobs.has(record.key)) throw new Error("旧版素材编号重复或无效。");
    // 只解码真正被引用的文件，未引用缓存不会造成迁移失败。
    blobs.set(record.key, null as unknown as Blob);
  }
  const records = new Map([...legacyRecords(backup, "image_files"), ...legacyRecords(backup, "media_files")].map(record => [record.key, record.value]));
  const referenced = (value: unknown, field = "", keys = new Set<string>()): Set<string> => {
    if (typeof value === "string" && fields.has(field) && /^(image|video|audio|file):/.test(value)) keys.add(value);
    else if (Array.isArray(value)) value.forEach(item => referenced(item, field, keys));
    else if (object(value)) for (const [key, item] of Object.entries(value)) referenced(item, key, keys);
    return keys;
  };
  const zip = new Map<string, Blob>();
  const missing = new Map<string, string>(), missingMedia: LegacyProducts["missingMedia"] = [];
  const packaged = roots.map(project => ({ project, files: [...referenced(project)].map(key => {
    if (!records.has(key)) {
      const replacement = `${key.split(":")[0]}:${sourceId}_missing_${encodeURIComponent(key)}`;
      missing.set(key, replacement);
      missingMedia.push({ key, product: project.title, replacement });
      return null;
    }
    if (!blobs.get(key)) blobs.set(key, decodeLegacyBlob(records.get(key)));
    const blob = blobs.get(key)!; zip.set(key, blob);
    return { storageKey: key, path: key, bytes: blob.size, mimeType: blob.type };
  }).filter(item => item !== null) }));
  const prepared = roots.length ? prepareCanvasExport({ app: "infinite-canvas", version: 3, projects: packaged }, zip, missing) : { projects: [], media: [] };
  const preparedById = new Map(prepared.projects.map(item => [item.project.id, normalizeLegacyMediaReferences(item.project)]));
  const guanWorkbooks: ExcelWorkbooks | null = contract ? { version: 1,
    contract: remapContract(contract, mappedId), activeByWorkbook: {} } : null;
  if (guanWorkbooks) for (const bookId of [null, ...contract!.productSets.map(book => book.id)]) {
    const selected = backup.localStorage[`guan-workbook-active-canvas:${encodeURIComponent(bookId ?? "__unbound__")}`];
    if (selected && projects.some(project => project.id === mappedId(selected) && (project.productSetId ?? null) === (bookId ? mappedId(bookId) : null)))
      guanWorkbooks.activeByWorkbook[bookId ? mappedId(bookId) : "__unbound__"] = mappedId(selected);
  }
  const snapshot = { projects: projects.map(item => preparedById.get(item.id)!), deletedProjects: deletedProjects.map(item => ({ ...item, project: preparedById.get(item.id)! })), guanWorkbooks };
  assertWorkbookSnapshot(snapshot);
  if (nativeDeleted.some(item => !deletedProjects.some(entry => entry.id === mappedId(String(item.id))))) warnings.push("原生画布的无快照删除标记只保留在原备份；不会恢复成产品。");
  warnings.push("历史记录随产品卡片迁移；全局素材库、独立生成日志、代理订阅/进程及安全凭据绑定暂不自动恢复，原完整备份保留。Excel 已解析模板和产品参数会迁入，原始 Excel 文件仍请保留。");
  if (missingMedia.length) warnings.push(`原备份已有 ${new Set(missingMedia.map(item => item.key)).size} 份素材缺失；迁移会保留原卡片和缺失编号，不伪造文件。`);
  return { snapshot, media: prepared.media, preferences, warnings, sourceId, missingMedia };
}
function remapContract(contract: WorkbookContract, id: (value: string) => string): WorkbookContract {
  // 宿主合同中所有 id/…Id/…Ids 均属于同一个源命名空间，防止覆盖目标已有记录。
  const walk = (value: unknown, field = ""): unknown => {
    // 产品原始属性、表头映射和模板正文可能含用户自定义的 id/productId 列，不能改写它们。
    if (["attributes", "identity", "headerMap"].includes(field) || (field === "prompts" && object(value))) return structuredClone(value);
    if (typeof value === "string" && (field === "id" || /Ids?$/.test(field))) return value ? id(value) : value;
    if (Array.isArray(value)) return value.map(item => walk(item, field));
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, key)]));
    return value;
  };
  return walk(contract) as WorkbookContract;
}

export function remapLegacyProjectChannels(snapshot: WorkbookSnapshot, channelIds: ReadonlyMap<string, string>): WorkbookSnapshot {
  const modelFields = new Set(["model", "modelId", "imageModel", "videoModel", "audioModel", "textModel"]);
  const walk = (value: unknown, field = ""): unknown => {
    if (typeof value === "string") {
      if (["channelId", "profileId", "generationChannelId"].includes(field)) return channelIds.get(value) ?? value;
      const split = value.indexOf("::");
      if (modelFields.has(field) && split >= 0) return `${channelIds.get(value.slice(0, split)) ?? value.slice(0, split)}::${value.slice(split + 2)}`;
    }
    if (Array.isArray(value)) return value.map(item => walk(item, field));
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, key)]));
    return value;
  };
  return { ...snapshot, projects: walk(snapshot.projects) as CanvasProject[], deletedProjects: walk(snapshot.deletedProjects) as CanvasDeletedProject[] };
}

export function mergeLegacyProducts(target: WorkbookSnapshot, incoming: WorkbookSnapshot) {
  const existing = new Set([...target.projects, ...target.deletedProjects].map(item => item.id));
  const projects = incoming.projects.filter(item => !existing.has(item.id));
  const deleted = incoming.deletedProjects.filter(item => !existing.has(item.id));
  let guanWorkbooks = target.guanWorkbooks;
  if (incoming.guanWorkbooks) {
    if (!guanWorkbooks) guanWorkbooks = incoming.guanWorkbooks;
    else {
      const contract = { ...guanWorkbooks.contract };
      for (const [key, value] of Object.entries(incoming.guanWorkbooks.contract)) {
        if (!Array.isArray(value)) continue;
        const previous = Array.isArray(contract[key]) ? contract[key] as Array<{ id?: string }> : [];
        const ids = new Set(previous.map(item => item.id));
        contract[key] = [...previous, ...value.filter(item => !object(item) || !item.id || !ids.has(String(item.id)))];
      }
      contract.productSets = contract.productSets.map(book => ({ ...book, productIds: [...new Set([...book.productIds,
        ...contract.products.filter(product => product.productSetId === book.id).map(product => product.id)])] }));
      guanWorkbooks = { ...guanWorkbooks, contract };
    }
  }
  const snapshot = { projects: [...target.projects, ...projects], deletedProjects: [...target.deletedProjects, ...deleted], guanWorkbooks };
  assertWorkbookSnapshot(snapshot);
  return { snapshot, added: projects.length, recycled: deleted.length, skipped: incoming.projects.length + incoming.deletedProjects.length - projects.length - deleted.length, ids: [...projects, ...deleted].map(item => item.id) };
}
