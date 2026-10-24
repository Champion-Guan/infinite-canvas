import type { CanvasProject, CanvasDeletedProject } from "@/stores/canvas/use-canvas-store";
import { createEmptyWorkbook, importPromptProducts } from "./旧版Excel合同.js";
import { productDisplayName } from "../产品/旧版产品显示名.js";

export type PromptTemplate = { id: string; order: number; route: string; sourceRowNumber: number; prompts: Record<string, string> };
export type WorkbookSource = {
  kind: string; fileName: string; fileSha256?: string; sheetName?: string; role?: string;
  promptSelectionKey?: string; promptSheetName?: string; promptTemplates: PromptTemplate[];
  promptTemplateCount?: number; headerMap?: Record<string, string>; importedAt: string;
};
export type Workbook = { id: string; source: WorkbookSource; productIds: string[]; createdAt: string; updatedAt: string };
export type ImportedProduct = { id: string; productSetId: string; order: number; sourceRowNumber: number; identity: { titleZh?: string }; attributes: Record<string, unknown>; createdAt: string; updatedAt: string };
export type WorkbookContract = {
  schema: string; workspace: { activeProductSetId: string | null; activeProductId: string | null };
  productSets: Workbook[]; products: ImportedProduct[]; [key: string]: unknown;
};
export type ExcelWorkbooks = { version: 1; contract: WorkbookContract; activeByWorkbook: Record<string, string> };
export type WorkbookSnapshot = { projects: CanvasProject[]; deletedProjects: CanvasDeletedProject[]; guanWorkbooks: ExcelWorkbooks | null };
export type ExcelImportInput = { fileName: string; kind: string; fileSha256?: string; sheetName: string; promptSheetName: string; promptTemplates: PromptTemplate[]; productRows?: Record<string, unknown>[]; sourceRowNumbers?: number[]; headerMap?: Record<string, string> };

export const workbookSelectionKey = (id: string | null) => id ?? "__unbound__";
export const currentWorkbookId = (value: ExcelWorkbooks | null) => value?.contract.workspace.activeProductSetId ?? null;
export const workbookProjects = (projects: readonly CanvasProject[], owner: string | null) => projects.filter(project => (project.productSetId ?? null) === owner);
export function orderedWorkbookProjects(projects: readonly CanvasProject[], owner: string | null, products: readonly ImportedProduct[] = []) {
  const imported = new Map(products.filter(product => product.productSetId === owner).map(product => [product.id, product]));
  return [...workbookProjects(projects, owner)].reverse().sort((a, b) => {
    const left = imported.get(a.id), right = imported.get(b.id);
    if (left && !right) return -1;
    if (!left && right) return 1;
    return (left && right ? left.order - right.order : 0) || a.createdAt.localeCompare(b.createdAt);
  });
}
export function visibleWorkbookId(snapshot: WorkbookSnapshot, activeId: string) {
  const current = snapshot.projects.find(project => project.id === activeId);
  return current ? current.productSetId ?? null : currentWorkbookId(snapshot.guanWorkbooks);
}
export function workbookEntry(snapshot: WorkbookSnapshot, owner = currentWorkbookId(snapshot.guanWorkbooks), fallbackRemembered: string | null = null) {
  const projects = workbookProjects(snapshot.projects, owner);
  const remembered = snapshot.guanWorkbooks?.activeByWorkbook[workbookSelectionKey(owner)] ?? fallbackRemembered;
  const order = snapshot.guanWorkbooks?.contract.productSets.find(book => book.id === owner)?.productIds ?? [];
  return projects.find(project => project.id === remembered)?.id
    ?? order.find(id => projects.some(project => project.id === id))
    ?? [...projects].reverse().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id ?? null;
}
export function selectWorkbook(snapshot: WorkbookSnapshot, owner: string | null) {
  if (owner && !snapshot.guanWorkbooks?.contract.productSets.some(book => book.id === owner)) throw new Error("工作簿不存在，未切换产品。");
  if (!snapshot.guanWorkbooks) return null;
  return { ...snapshot.guanWorkbooks, contract: { ...snapshot.guanWorkbooks.contract,
    workspace: { ...snapshot.guanWorkbooks.contract.workspace, activeProductSetId: owner } } };
}
export function rememberWorkbookProduct(snapshot: WorkbookSnapshot, id: string): ExcelWorkbooks | null {
  const project = snapshot.projects.find(item => item.id === id);
  if (!project) throw new Error("目标产品不存在。");
  const value = snapshot.guanWorkbooks;
  if (!value) return null;
  const owner = project.productSetId ?? null;
  if (owner && !value.contract.productSets.some(book => book.id === owner)) throw new Error("产品的工作簿归属异常，未切换。");
  return { ...value, activeByWorkbook: { ...value.activeByWorkbook, [workbookSelectionKey(owner)]: id },
    contract: { ...value.contract, workspace: { ...value.contract.workspace, activeProductSetId: owner, activeProductId: id } } };
}
export function withVisibleSelection(snapshot: WorkbookSnapshot, id: string): WorkbookSnapshot {
  return id && snapshot.projects.some(project => project.id === id)
    ? { ...snapshot, guanWorkbooks: rememberWorkbookProduct(snapshot, id) } : snapshot;
}

// 仅修正旧迁入代码直接写入的完整路线，人工标题不做截断。
export function normalizeExcelCanvasTitles(snapshot: WorkbookSnapshot) {
  const imported = new Map(snapshot.guanWorkbooks?.contract.products.map(product => [product.id, product]));
  let changed = false;
  const projects = snapshot.projects.map(project => {
    const product = imported.get(project.id);
    if (!product || project.productSetId !== product.productSetId || project.title !== product.identity.titleZh) return project;
    const title = productDisplayName(product, product.order - 1);
    if (title === project.title) return project;
    changed = true;
    return { ...project, title };
  });
  return changed ? projects : snapshot.projects;
}

// 仅适配数据边界：工作簿、产品及归属同存一个已批准的canvas_store分片根，不建第二套产品库。
export function planExcelImport(snapshot: WorkbookSnapshot, input: ExcelImportInput): WorkbookSnapshot {
  if (!input.promptTemplates.length || input.promptTemplates.some(template => !template.id || !Object.keys(template.prompts).length)) throw new Error("没有可导入的提示词模板");
  const contract = structuredClone(snapshot.guanWorkbooks?.contract ?? createEmptyWorkbook()) as WorkbookContract;
  const previousTitles = new Map(contract.products.map(product => [product.id, product.identity.titleZh]));
  const result = importPromptProducts(contract, { ...input, sourceRowNumbers: input.sourceRowNumbers ?? input.promptTemplates.map(template => template.sourceRowNumber) });
  const owner = result.productSetId as string;
  const imported = contract.products.filter(product => product.productSetId === owner);
  const archived = new Set(snapshot.deletedProjects.map(entry => entry.id));
  const byId = new Map(imported.map(product => [product.id, product]));
  let projects = snapshot.projects.map(project => {
    const product = byId.get(project.id);
    if (product) {
      if (project.productSetId !== owner) throw new Error("产品ID归属冲突，未覆盖原画布。");
      // 只同步Excel来源及旧版标题，不重排节点、不覆写人工画布、输出媒体和任务。
      const previousTitle = previousTitles.get(project.id);
      const keepManualTitle = previousTitle && project.title !== previousTitle && project.title !== productDisplayName({ title: previousTitle }, product.order - 1);
      return { ...project, title: keepManualTitle ? project.title : productDisplayName(product, product.order - 1) };
    }
    // 与旧版readCanvasProducts相同：只有没有归属字段的历史产品一次性归属当前工作簿。
    return Object.hasOwn(project, "productSetId") ? project : { ...project, productSetId: owner };
  });
  const existing = new Set(projects.map(project => project.id));
  const additions = imported.filter(product => !existing.has(product.id) && !archived.has(product.id)).map(product => ({
    id: product.id, title: productDisplayName(product, product.order - 1), productSetId: owner,
    createdAt: product.createdAt, updatedAt: product.updatedAt, nodes: [], connections: [], chatSessions: [], activeChatId: null,
    backgroundMode: "lines" as const, showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
  }));
  projects = [...additions.reverse(), ...projects];
  const guanWorkbooks: ExcelWorkbooks = { version: 1, contract, activeByWorkbook: { ...snapshot.guanWorkbooks?.activeByWorkbook } };
  const selected = workbookEntry({ ...snapshot, projects, guanWorkbooks }, owner);
  if (selected) guanWorkbooks.activeByWorkbook[workbookSelectionKey(owner)] = selected;
  return { projects, deletedProjects: snapshot.deletedProjects, guanWorkbooks };
}

export function assertWorkbookSnapshot(value: WorkbookSnapshot) {
  const books = value.guanWorkbooks;
  if (books === null || books === undefined) return; // 唯一合法的旧根兼容，不吞损坏的新格式。
  const fail = () => { throw new Error("Excel工作簿或产品归属数据异常，未作为空库覆盖。"); };
  if (books.version !== 1 || !books.contract || books.contract.schema !== "guan-workbench.v1"
    || !Array.isArray(books.contract.productSets) || !Array.isArray(books.contract.products)
    || !books.contract.workspace || !books.activeByWorkbook || typeof books.activeByWorkbook !== "object" || Array.isArray(books.activeByWorkbook)) fail();
  const owners = new Set<string>(), productIds = new Set<string>();
  for (const book of books.contract.productSets) {
    if (!book || typeof book.id !== "string" || !book.id || owners.has(book.id) || !book.source || typeof book.source.fileName !== "string"
      || !Array.isArray(book.source.promptTemplates) || !Array.isArray(book.productIds)) fail();
    owners.add(book.id);
  }
  for (const product of books.contract.products) {
    if (!product || typeof product.id !== "string" || productIds.has(product.id) || !owners.has(product.productSetId) || !product.identity || !product.attributes) fail();
    productIds.add(product.id);
  }
  const active = books.contract.workspace.activeProductSetId;
  if (active !== null && !owners.has(active)) fail();
  for (const project of [...value.projects, ...value.deletedProjects.flatMap(entry => entry.project ? [entry.project] : [])]) {
    if (project.productSetId && !owners.has(project.productSetId)) fail();
  }
  for (const [key, id] of Object.entries(books.activeByWorkbook)) {
    if (key !== "__unbound__" && !owners.has(key)) fail();
    if (typeof id !== "string") fail();
  }
  for (const book of books.contract.productSets) {
    if (new Set(book.productIds).size !== book.productIds.length || book.productIds.some(id => !books.contract.products.some(product => product.id === id && product.productSetId === book.id))) fail();
    if (book.source.promptTemplates.some(template => !template || typeof template.id !== "string" || typeof template.route !== "string" || !template.prompts || typeof template.prompts !== "object" || Array.isArray(template.prompts))) fail();
  }
}
