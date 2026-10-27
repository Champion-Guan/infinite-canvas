import { assertWorkbookSnapshot, type WorkbookSnapshot } from "../Excel/Excel产品归属";
import { canvasTaskSummary } from "../产品/产品任务摘要.js";
import { deleteLegacyWorkbook } from "./旧版工作簿删除.js";
import { createWorkbookRecycleEntry } from "./Excel回收站规则";

export type WorkbookDeletionPlan = { workbookId: string; deletedIds: string[]; navigate: boolean; state: WorkbookSnapshot };
const recordCollections = ["importRecords", "slots", "prompts", "tasks", "runs", "providerAttempts", "assets"] as const;
type RecordRow = { id: string; productId?: string; productSetId?: string; taskId?: string; runId?: string; status?: string };
const relationshipKeys = ["productId", "productSetId", "taskId", "runId"] as const;
function records(snapshot: WorkbookSnapshot, key: typeof recordCollections[number]): RecordRow[] {
  const value = snapshot.guanWorkbooks?.contract[key];
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" || !row.id)
    || value.some(row => relationshipKeys.some(key => row[key] != null && (typeof row[key] !== "string" || !row[key])))
    || new Set(value.map(row => row.id)).size !== value.length) throw new Error("工作簿关联记录异常，未执行删除。");
  return value;
}
function guardKeptReferences(rows: readonly object[], fields: readonly [string, Set<string>, boolean?][]) {
  for (const row of rows) for (const [key, removed, multiple] of fields) {
    const value = (row as Record<string, unknown>)[key];
    if (value == null) continue;
    const references = multiple ? value : [value];
    if (!Array.isArray(references) || references.some(id => typeof id !== "string" || !id)) throw new Error("工作簿关联记录异常，未执行删除。");
    if (references.some(id => removed.has(id))) throw new Error("其他保留记录仍引用待删除内容，未执行删除；请先核对跨工作簿关联。");
  }
}

export function workbookDeletionIds(snapshot: WorkbookSnapshot, workbookId: string): string[] {
  assertWorkbookSnapshot(snapshot);
  const contract = snapshot.guanWorkbooks?.contract;
  if (!workbookId || !contract?.productSets.some(book => book.id === workbookId)) throw new Error("工作簿不存在，未执行删除。");
  if (new Set(snapshot.projects.map(project => project.id)).size !== snapshot.projects.length) throw new Error("产品ID重复，未执行删除。");
  const imported = new Set(contract.products.filter(product => product.productSetId === workbookId).map(product => product.id));
  const owners = new Map(contract.products.map(product => [product.id, product.productSetId]));
  if (snapshot.projects.some(project => (imported.has(project.id) || project.productSetId === workbookId)
    && owners.has(project.id) && owners.get(project.id) !== project.productSetId)) throw new Error("产品ID归属冲突，未执行删除。");
  return [...new Set([...imported, ...snapshot.projects.filter(project => project.productSetId === workbookId).map(project => project.id)])];
}

export function planWorkbookDeletion(snapshot: WorkbookSnapshot, workbookId: string, activeId: string): WorkbookDeletionPlan {
  const deletedIds = workbookDeletionIds(snapshot, workbookId), ids = new Set(deletedIds);
  if (snapshot.deletedProjects.some(entry => ids.has(entry.id) || entry.project?.productSetId === workbookId))
    throw new Error("此工作簿还有产品在回收站，请先恢复这些产品，再执行整批删除；未删除恢复快照。");
  for (const project of snapshot.projects) if (ids.has(project.id) && canvasTaskSummary(project.nodes, project.connections).status === "loading")
    throw new Error("该工作簿有生成任务运行中，请等待任务结束后再删除。");
  const nodeStates = new Set(["idle", "success", "error"]);
  for (const project of snapshot.projects) if (ids.has(project.id)) for (const node of project.nodes) {
    const metadata = node.metadata;
    if ([metadata?.status, ...(metadata?.images ?? []).map(image => image.status), ...(metadata?.texts ?? []).map(text => text.status)]
      .some(status => status != null && !nodeStates.has(status))) throw new Error("该工作簿有状态未决的节点任务，未执行删除。");
  }
  const entries = Object.fromEntries(recordCollections.map(key => [key, records(snapshot, key)])) as Record<typeof recordCollections[number], RecordRow[]>;
  const taskIds = new Set(entries.tasks.filter(row => ids.has(row.productId ?? "")).map(row => row.id));
  const runIds = new Set(entries.runs.filter(row => ids.has(row.productId ?? "") || taskIds.has(row.taskId ?? "")).map(row => row.id));
  const related = [...entries.tasks.filter(row => taskIds.has(row.id)), ...entries.runs.filter(row => runIds.has(row.id)), ...entries.providerAttempts.filter(row => runIds.has(row.runId ?? ""))];
  const settled = new Set(["draft", "ready", "succeeded", "success", "failed", "error", "cancelled", "canceled", "partial", "skipped"]);
  if (related.some(row => !row.status || !settled.has(row.status))) throw new Error("该工作簿有运行中或状态未决的任务，未执行删除。");
  const books = snapshot.guanWorkbooks!;
  const contract = structuredClone(books.contract);
  const previousSelection = { ...contract.workspace };
  const recycleEntry = createWorkbookRecycleEntry(snapshot, workbookId, new Date().toISOString());
  deleteLegacyWorkbook(contract, workbookId);
  // 不扩大旧级联的删除范围：关联冲突或自建产品出现旧合同不支持的记录时停止，禁止留下悬空记录。
  const targets = { productId: ids, productSetId: new Set([workbookId]), taskId: taskIds, runId: runIds };
  for (const key of recordCollections) {
    const remaining = new Set((contract[key] as RecordRow[]).map(row => row.id));
    for (const row of entries[key]) {
      const references = relationshipKeys.filter(key => row[key] != null).map(key => targets[key].has(row[key]!));
      if (!references.includes(true)) continue;
      if (references.includes(false)) throw new Error("工作簿关联归属冲突，未执行删除。");
      if (remaining.has(row.id)) throw new Error("存在旧合同不支持的关联记录，未执行删除；请先核对产品关联。");
    }
  }
  const remainingRecords = Object.fromEntries(recordCollections.map(key => [key, contract[key]])) as typeof entries;
  const removedRecords = Object.fromEntries(recordCollections.map(key => {
    const kept = new Set(remainingRecords[key].map(row => row.id));
    return [key, new Set(entries[key].filter(row => !kept.has(row.id)).map(row => row.id))];
  })) as Record<typeof recordCollections[number], Set<string>>;
  guardKeptReferences(contract.products, [["sourceAssets", removedRecords.assets, true], ["importRecordId", removedRecords.importRecords]]);
  guardKeptReferences(remainingRecords.tasks, [["inputAssetIds", removedRecords.assets, true], ["outputAssetIds", removedRecords.assets, true], ["promptId", removedRecords.prompts], ["activeRunId", removedRecords.runs]]);
  guardKeptReferences(remainingRecords.runs, [["inputAssetIds", removedRecords.assets, true], ["outputAssetIds", removedRecords.assets, true], ["attemptIds", removedRecords.providerAttempts, true]]);
  for (const asset of remainingRecords.assets) {
    const lineage = (asset as Record<string, unknown>).lineage;
    if (lineage != null) {
      if (typeof lineage !== "object" || Array.isArray(lineage)) throw new Error("素材来源记录异常，未执行删除。");
      guardKeptReferences([lineage], [["parentAssetIds", removedRecords.assets, true], ["sourceTaskId", removedRecords.tasks]]);
    }
  }
  // 后台工作簿删除不能抢走实际打开产品的选择；旧纯函数的级联范围保持原文。
  if (previousSelection.activeProductSetId !== workbookId) contract.workspace = previousSelection;
  const activeByWorkbook = { ...books.activeByWorkbook };
  delete activeByWorkbook[workbookId];
  for (const [owner, id] of Object.entries(activeByWorkbook)) if (ids.has(id)) delete activeByWorkbook[owner];
  const recycledWorkbooks = [...(books.recycledWorkbooks ?? []).filter(entry => entry.id !== workbookId), recycleEntry];
  const state: WorkbookSnapshot = { projects: snapshot.projects.filter(project => !ids.has(project.id)), deletedProjects: snapshot.deletedProjects,
    guanWorkbooks: { ...books, contract, activeByWorkbook, recycledWorkbooks } };
  assertWorkbookSnapshot(state);
  return { workbookId, deletedIds, navigate: ids.has(activeId) || (!activeId && previousSelection.activeProductSetId === workbookId), state };
}
