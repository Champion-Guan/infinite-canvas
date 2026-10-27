import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata, CanvasNodeTypeId, Position } from "@/types/canvas";
import { buildPromptVariablesMetadata, PROMPT_VARIABLES_NODE_TYPE, promptVariableTokens, resolvePromptVariables, completePromptVariableValues } from "./旧版参数规则";
import { finalPromptPreviewTitle } from "./旧版最终提示词标题";
import { excelPromptItems, type ProductExcelContext } from "./Excel卡片上下文";

export { reconcileExcelPreviews } from "./产品参数联动";

export type Factory = {
  create: (type: CanvasNodeTypeId, center: Position, metadata?: CanvasNodeMetadata) => CanvasNodeData;
  edgeId: () => string;
  place: (node: CanvasNodeData, occupied: CanvasNodeData[]) => CanvasNodeData;
};
export type ExcelInsertRequest = { productId: string; includeVideo?: boolean; templateId?: string; key?: string };
export function createProductParameterNode(context: ProductExcelContext, center: Position, values: Record<string, string>, factory: Factory) {
  return factory.create(PROMPT_VARIABLES_NODE_TYPE, center, buildPromptVariablesMetadata(context, undefined, undefined, values));
}

// 从旧connectNodes拆出的同笔节点/边事务；只新增预览，新建避让绝不移动两个既有端点。
export function bindExcelParameters(nodes: CanvasNodeData[], connections: CanvasConnection[], fromNodeId: string, toNodeId: string, factory: Factory, previewGap = 96) {
  const pair = nodes.filter(node => node.id === fromNodeId || node.id === toNodeId);
  const parameter = pair.find(node => node.type === PROMPT_VARIABLES_NODE_TYPE);
  const source = pair.find(node => node.type === "text" && !node.metadata?.promptVariablePreviewOf);
  if (!parameter || !source) return null;
  if (source.metadata?.excelPromptBindingNodeId && source.metadata.excelPromptBindingNodeId !== parameter.id) throw new Error("该提示词已连接另一张参数卡，请先断开原连线。");
  const raw = (source.metadata?.content || source.metadata?.prompt || "").trim();
  const tokens = promptVariableTokens(raw);
  const values = completePromptVariableValues(tokens, parameter.metadata?.promptVariableValues);
  const text = resolvePromptVariables(raw, values, parameter.metadata?.promptVariableSupplement || "");
  const existing = nodes.find(node => node.metadata?.promptVariablePreviewOf === parameter.id && node.metadata?.promptVariableSourceNodeId === source.id);
  let preview = existing;
  if (!preview) {
    const draft = factory.create("text", { x: 0, y: 0 }, { content: text, prompt: text, status: "success", promptVariablePreviewOf: parameter.id, promptVariableSourceNodeId: source.id });
    preview = factory.place({ ...draft, title: finalPromptPreviewTitle(source), position: { x: source.position.x + source.width + previewGap, y: source.position.y } }, nodes);
  }
  const nextNodes = nodes.map(node => {
    if (node.id === parameter.id) return { ...node, metadata: { ...node.metadata, status: "success" as const, promptVariableRawPrompt: raw, promptVariableResolvedPrompt: text, promptVariableTokens: tokens, promptVariableValues: values, promptVariableSourceNodeId: source.id, promptVariablePreviewNodeId: preview.id } };
    if (node.id === source.id) return { ...node, metadata: { ...node.metadata, excelPromptRaw: node.metadata?.excelPromptRaw || raw, excelPromptResolved: text, excelPromptBindingNodeId: parameter.id, excelPromptTokens: node.metadata?.excelPromptTokens?.length ? node.metadata.excelPromptTokens : tokens } };
    if (node.id === preview.id) return { ...node, title: finalPromptPreviewTitle(source), metadata: { ...node.metadata, content: text, prompt: text, status: "success" as const } };
    return node;
  });
  if (!existing) nextNodes.push(preview);
  const nextConnections = [...connections];
  for (const [from, to] of [[fromNodeId, toNodeId], [source.id, preview.id]]) {
    if (!nextConnections.some(edge => edge.fromNodeId === from && edge.toNodeId === to)) nextConnections.push({ id: factory.edgeId(), fromNodeId: from, toNodeId: to });
  }
  return { nodes: nextNodes, connections: nextConnections };
}

export function insertExcelPromptCards(nodes: CanvasNodeData[], connections: CanvasConnection[], context: ProductExcelContext, request: ExcelInsertRequest, center: Position, factory: Factory, confirmOverwrite: (node: CanvasNodeData) => boolean | undefined, sync: (nodes: CanvasNodeData[], context: ProductExcelContext, confirm: typeof confirmOverwrite) => CanvasNodeData[]) {
  if (request.productId !== context.productId) throw new Error("产品已切换，未向其他产品插入提示词。");
  if ((request.key !== undefined || request.templateId !== undefined) && (!request.key || !request.templateId)) throw new Error("提示词列身份不完整，未按整批导入处理。");
  const selected = excelPromptItems(context).filter(item => request.key ? item.excelPrompt.templateId === request.templateId && item.excelPrompt.key === request.key : request.includeVideo || item.excelPrompt.kind !== "video");
  if (!selected.length) throw new Error("当前产品没有匹配的Excel提示词，未借用其他产品内容。");
  let nextNodes = sync(nodes, context, confirmOverwrite), nextConnections = connections;
  const selectedIds: string[] = [];
  const parameter = nextNodes.find(node => node.type === PROMPT_VARIABLES_NODE_TYPE);
  let additions = 0;
  for (const item of selected) {
    const meta = item.excelPrompt;
    let source = nextNodes.find(node => node.type === "text" && !node.metadata?.promptVariablePreviewOf && (
      node.metadata?.excelPromptKey ? node.metadata.excelPromptKey === meta.key && node.metadata.excelPromptTemplateId === meta.templateId
        : node.metadata?.excelPromptRaw === item.prompt || node.metadata?.content === item.prompt));
    if (!source) {
      const draft = factory.create("text", center, { content: item.prompt, status: "success", excelPromptTemplateId: meta.templateId, excelPromptKey: meta.key, excelPromptLabel: meta.label, excelPromptTheme: meta.theme, excelPromptCompositionLock: meta.compositionLock, excelPromptPurpose: meta.purpose, excelPromptTokens: meta.tokens, excelPromptRaw: item.prompt });
      source = factory.place({ ...draft, title: item.title, position: { ...draft.position, y: draft.position.y + additions * (draft.height + 72) } }, nextNodes);
      additions++;
      nextNodes = [...nextNodes, source];
    }
    selectedIds.push(source.id);
    // 旧版只在一键导入且已有参数卡时自动连接；单独插入仍由用户选择连线。
    if (!request.key && parameter && (!source.metadata?.excelPromptBindingNodeId || source.metadata.excelPromptBindingNodeId === parameter.id)) {
      const bound = bindExcelParameters(nextNodes, nextConnections, parameter.id, source.id, factory, 72);
      if (bound) { nextNodes = bound.nodes; nextConnections = bound.connections; }
    }
  }
  return { nodes: nextNodes, connections: nextConnections, selectedIds };
}

export function excelDeletionIds(nodes: CanvasNodeData[], ids: Set<string>) {
  const all = new Set(ids);
  for (const node of nodes) if (node.metadata?.promptVariablePreviewOf &&
    (all.has(node.metadata.promptVariablePreviewOf) || all.has(node.metadata.promptVariableSourceNodeId || ""))) all.add(node.id);
  return all;
}
export function clearDeletedExcelRelations(node: CanvasNodeData, ids: Set<string>): CanvasNodeData {
  const old = node.metadata;
  if (!old) return node;
  const metadata = { ...old };
  let changed = false;
  for (const key of ["promptVariableSourceNodeId", "promptVariablePreviewNodeId", "excelPromptBindingNodeId"] as const) {
    if (metadata[key] && ids.has(metadata[key]!)) { metadata[key] = undefined; changed = true; }
  }
  if (old.promptVariableSourceNodeId && ids.has(old.promptVariableSourceNodeId)) { metadata.promptVariableRawPrompt = ""; metadata.promptVariableResolvedPrompt = ""; }
  if (old.excelPromptBindingNodeId && ids.has(old.excelPromptBindingNodeId)) metadata.excelPromptResolved = undefined;
  return changed ? { ...node, metadata } : node;
}

export function disconnectExcelParameters(nodes: CanvasNodeData[], connections: CanvasConnection[], id: string, matches = (item: CanvasConnection) => item.id === id) {
  const edge = connections.find(matches);
  if (!edge) return null;
  const pair = nodes.filter(node => node.id === edge.fromNodeId || node.id === edge.toNodeId);
  const parameter = pair.find(node => node.type === PROMPT_VARIABLES_NODE_TYPE);
  const source = pair.find(node => node.metadata?.excelPromptBindingNodeId === parameter?.id);
  if (!parameter || !source) return null;
  // 两个方向均存在时只移除用户指定的边，剩余边仍维持绑定。
  const rest = connections.filter(item => !matches(item));
  if (rest.some(item => [item.fromNodeId, item.toNodeId].includes(parameter.id) && [item.fromNodeId, item.toNodeId].includes(source.id))) return { nodes, connections: rest };
  const previews = new Set(nodes.filter(node => node.metadata?.promptVariablePreviewOf === parameter.id && node.metadata?.promptVariableSourceNodeId === source.id).map(node => node.id));
  return { nodes: nodes.filter(node => !previews.has(node.id)).map(node => {
    if (node.id === source.id) return { ...node, metadata: { ...node.metadata, excelPromptBindingNodeId: undefined, excelPromptResolved: undefined } };
    if (node.id === parameter.id && node.metadata?.promptVariableSourceNodeId === source.id) return { ...node, metadata: { ...node.metadata, promptVariableSourceNodeId: undefined, promptVariablePreviewNodeId: undefined, promptVariableRawPrompt: "", promptVariableResolvedPrompt: "" } };
    return clearDeletedExcelRelations(node, previews);
  }), connections: rest.filter(item => !previews.has(item.fromNodeId) && !previews.has(item.toNodeId)) };
}

export function remapCopiedExcelRelations(node: CanvasNodeData, idMap: Map<string, string>): CanvasNodeData {
  if (!node.metadata) return node;
  const metadata = { ...node.metadata };
  for (const key of ["promptVariableSourceNodeId", "promptVariablePreviewNodeId", "excelPromptBindingNodeId", "promptVariablePreviewOf", "promptVariableEnglishPreviewOf", "promptVariableTranslationOf"] as const) {
    const id = metadata[key];
    if (id && idMap.has(id)) metadata[key] = idMap.get(id);
    else if (id && node.type === PROMPT_VARIABLES_NODE_TYPE) metadata[key] = undefined;
  }
  if (node.type === PROMPT_VARIABLES_NODE_TYPE && !metadata.promptVariableSourceNodeId) { metadata.promptVariableRawPrompt = ""; metadata.promptVariableResolvedPrompt = ""; }
  return { ...node, metadata };
}
