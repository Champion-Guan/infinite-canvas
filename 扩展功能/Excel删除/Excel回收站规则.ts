import type { CanvasDeletedProject } from "@/stores/canvas/use-canvas-store";
import type { ExcelWorkbookRecycleEntry, ExcelWorkbooks, WorkbookSnapshot } from "../Excel/Excel产品归属";

const recordCollections = ["importRecords", "slots", "prompts", "tasks", "runs", "providerAttempts", "assets"] as const;
type RecordCollection = typeof recordCollections[number];
type RecordRow = Record<string, unknown> & { id: string };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function contractRows(books: ExcelWorkbooks, key: RecordCollection): RecordRow[] {
  const rows = books.contract[key];
  if (!Array.isArray(rows)) throw new Error("工作簿关联记录异常，未执行回收。");
  return rows as RecordRow[];
}

/** 在删除前复制完整合同关联，媒体实体仍由媒体存储独立保留。 */
export function createWorkbookRecycleEntry(snapshot: WorkbookSnapshot, workbookId: string, deletedAt: string): ExcelWorkbookRecycleEntry {
  const books = snapshot.guanWorkbooks;
  const workbook = books?.contract.productSets.find(item => item.id === workbookId);
  if (!books || !workbook) throw new Error("工作簿不存在，未进入 Excel 回收站。");
  const products = books.contract.products.filter(product => product.productSetId === workbookId);
  const productIds = new Set(products.map(product => product.id));
  const taskIds = new Set(contractRows(books, "tasks").filter(row => productIds.has(String(row.productId ?? ""))).map(row => row.id));
  const runIds = new Set(contractRows(books, "runs").filter(row => productIds.has(String(row.productId ?? "")) || taskIds.has(String(row.taskId ?? ""))).map(row => row.id));
  const records: Partial<Record<RecordCollection, Record<string, unknown>[]>> = {};
  for (const key of recordCollections) {
    records[key] = contractRows(books, key).filter(row => {
      if (key === "importRecords") return row.productSetId === workbookId;
      if (key === "slots" || key === "prompts" || key === "tasks") return productIds.has(String(row.productId ?? ""));
      if (key === "runs") return productIds.has(String(row.productId ?? "")) || taskIds.has(String(row.taskId ?? ""));
      if (key === "providerAttempts") return runIds.has(String(row.runId ?? ""));
      return productIds.has(String(row.productId ?? "")) || taskIds.has(String(row.taskId ?? "")) || runIds.has(String(row.runId ?? ""));
    }).map(clone);
  }
  const projects = snapshot.projects.filter(project => project.productSetId === workbookId || productIds.has(project.id)).map(clone);
  const validSelectionIds = new Set([...products.map(product => product.id), ...projects.map(project => project.id)]);
  const remembered = books.contract.workspace.activeProductSetId === workbookId
    ? books.contract.workspace.activeProductId
    : books.activeByWorkbook[workbookId] ?? null;
  const activeProductId = remembered && validSelectionIds.has(remembered)
    ? remembered
    : projects[0]?.id ?? products[0]?.id ?? null;
  return { id: workbookId, deletedAt, workbook: clone(workbook), products: clone(products), projects,
    records, activeProductId };
}

function activeIds(books: ExcelWorkbooks) {
  const ids = new Set<string>();
  for (const book of books.contract.productSets) ids.add(book.id);
  for (const product of books.contract.products) ids.add(product.id);
  for (const key of recordCollections) for (const row of contractRows(books, key)) ids.add(row.id);
  return ids;
}

function allProjectIds(snapshot: WorkbookSnapshot) {
  return new Set<string>([
    ...snapshot.projects.map(project => project.id),
    ...snapshot.deletedProjects.map((entry: CanvasDeletedProject) => entry.id),
  ]);
}

function assertRestoreIdsAvailable(snapshot: WorkbookSnapshot, entry: ExcelWorkbookRecycleEntry) {
  const books = snapshot.guanWorkbooks!;
  if (books.contract.productSets.some(book => book.id === entry.id)) throw new Error("当前已有相同工作簿，未恢复回收站内容。");
  const ids = activeIds(books), projectIds = allProjectIds(snapshot);
  if (entry.products.some(product => ids.has(product.id) || projectIds.has(product.id))) throw new Error("回收站产品ID与当前数据冲突，未恢复。");
  if (entry.projects.some(project => projectIds.has(project.id) || ids.has(project.id))) throw new Error("回收站画布ID与当前数据冲突，未恢复。");
  for (const rows of Object.values(entry.records)) if (rows?.some(row => ids.has(String(row.id)))) throw new Error("回收站关联记录ID与当前数据冲突，未恢复。");
}

export function recycledWorkbookEntries(value: ExcelWorkbooks | null): ExcelWorkbookRecycleEntry[] {
  return value?.recycledWorkbooks ?? [];
}

export function planWorkbookRecycle(snapshot: WorkbookSnapshot, workbookId: string, deletedAt: string) {
  const books = snapshot.guanWorkbooks;
  if (!books) throw new Error("没有可回收的 Excel 工作簿。");
  const entry = createWorkbookRecycleEntry(snapshot, workbookId, deletedAt);
  const existing = books.recycledWorkbooks ?? [];
  if (existing.some(item => item.id === workbookId)) throw new Error("该工作簿已经在 Excel 回收站中。");
  return { entry, recycledWorkbooks: [...existing, entry] };
}

export function planWorkbookRestore(snapshot: WorkbookSnapshot, workbookId: string): WorkbookSnapshot {
  const books = snapshot.guanWorkbooks;
  const entry = recycledWorkbookEntries(books).find(item => item.id === workbookId);
  if (!books || !entry) throw new Error("Excel 回收站中没有可恢复的工作簿。");
  assertRestoreIdsAvailable(snapshot, entry);
  const contract = structuredClone(books.contract);
  contract.productSets = [...contract.productSets, clone(entry.workbook)];
  contract.products = [...contract.products, ...clone(entry.products)];
  for (const key of recordCollections) (contract as Record<string, unknown>)[key] = [...contractRows(books, key), ...(clone(entry.records[key] ?? []) as RecordRow[])];
  const activeByWorkbook = { ...books.activeByWorkbook, [entry.id]: entry.activeProductId ?? entry.workbook.productIds[0] ?? "" };
  if (!activeByWorkbook[entry.id]) delete activeByWorkbook[entry.id];
  const activeWasRemoved = books.contract.workspace.activeProductSetId === null;
  const workspace = activeWasRemoved ? {
    ...contract.workspace,
    activeProductSetId: entry.id,
    activeProductId: entry.activeProductId ?? entry.workbook.productIds[0] ?? null,
  } : contract.workspace;
  contract.workspace = workspace;
  const projects = [...clone(entry.projects), ...snapshot.projects];
  const next: WorkbookSnapshot = { projects, deletedProjects: snapshot.deletedProjects, guanWorkbooks: {
    ...books, contract, activeByWorkbook,
    recycledWorkbooks: books.recycledWorkbooks?.filter(item => item.id !== entry.id),
  } };
  return next;
}

function collectRelationshipIds(value: unknown, key = "") : Set<string> {
  const ids = new Set<string>();
  const visit = (current: unknown, hint: string) => {
    if (typeof current === "string" && (hint === "id" || /(?:^|_)id$/i.test(hint) || /ids$/i.test(hint) || hint === "sourceAssets")) ids.add(current);
    else if (Array.isArray(current)) current.forEach(item => visit(item, hint));
    else if (current && typeof current === "object") for (const [name, item] of Object.entries(current)) visit(item, name);
  };
  visit(value, key);
  return ids;
}

export function planWorkbookPermanentDelete(snapshot: WorkbookSnapshot, workbookId: string): WorkbookSnapshot {
  const books = snapshot.guanWorkbooks;
  const entry = recycledWorkbookEntries(books).find(item => item.id === workbookId);
  if (!books || !entry) throw new Error("Excel 回收站中没有可永久删除的工作簿。");
  const removedIds = new Set<string>([entry.id, ...entry.products.map(product => product.id), ...entry.projects.map(project => project.id)]);
  for (const rows of Object.values(entry.records)) for (const row of rows ?? []) removedIds.add(String(row.id));
  const activeData: unknown[] = [snapshot.projects, snapshot.deletedProjects, books.contract, books.activeByWorkbook];
  if (activeData.some(value => [...collectRelationshipIds(value)].some(id => removedIds.has(id))))
    throw new Error("当前数据仍引用该工作簿的产品或任务，未永久删除。");
  return { ...snapshot, guanWorkbooks: { ...books, recycledWorkbooks: books.recycledWorkbooks?.filter(item => item.id !== workbookId) } };
}
