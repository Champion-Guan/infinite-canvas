// 参数编辑与原文变更共用最终提示词组装；源卡原文保持独立。
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { resolvePromptVariables } from "../提示词/变量使用规则";
import { finalPromptPreviewTitle } from "./旧版最终提示词标题";

const rawPrompt = (node: CanvasNodeData) => String(node.metadata?.content ?? node.metadata?.excelPromptRaw ?? node.metadata?.prompt ?? "");
const resolvedPrompt = (source: CanvasNodeData, parameter: CanvasNodeData) => resolvePromptVariables(rawPrompt(source), parameter.metadata?.promptVariableValues, parameter.metadata?.promptVariableSupplement || "");
const parameterChanged = (before: CanvasNodeData | undefined, current: CanvasNodeData) =>
    before?.metadata?.promptVariableValues !== current.metadata?.promptVariableValues || before?.metadata?.promptVariableSupplement !== current.metadata?.promptVariableSupplement;

export function buildProductParameterEdits(nodes: CanvasNodeData[], connections: CanvasConnection[], parameterId: string, patch: CanvasNodeMetadata) {
    const original = nodes.find(node => node.id === parameterId && node.type === "guan:prompt-variables");
    if (!original) return [];
    const parameter = { ...original, metadata: { ...original.metadata, ...patch } };
    const linked = nodes.find(node => node.id === parameter.metadata.promptVariableSourceNodeId);
    const raw = linked ? rawPrompt(linked) : parameter.metadata.promptVariableRawPrompt || "";
    const metadata = { ...patch, promptVariableResolvedPrompt: resolvePromptVariables(raw, parameter.metadata.promptVariableValues, parameter.metadata.promptVariableSupplement || "") };
    const ops: CanvasAgentOp[] = [{ type: "update_node" as const, id: parameterId, metadata }];
    for (const source of nodes.filter(node => node.type === "text" && !node.metadata?.promptVariablePreviewOf &&
        (!node.metadata?.excelPromptBindingNodeId || node.metadata.excelPromptBindingNodeId === parameterId) &&
        (node.metadata?.excelPromptBindingNodeId === parameterId || connections.some(edge =>
            (edge.fromNodeId === parameterId && edge.toNodeId === node.id) || (edge.toNodeId === parameterId && edge.fromNodeId === node.id))))) {
        const text = resolvedPrompt(source, parameter);
        ops.push({ type: "update_node", id: source.id, metadata: { excelPromptResolved: text, excelPromptBindingNodeId: parameterId } });
        for (const preview of nodes.filter(node => node.metadata?.promptVariablePreviewOf === parameterId && node.metadata?.promptVariableSourceNodeId === source.id)) {
            ops.push({ type: "update_node", id: preview.id, metadata: { content: text, prompt: text, status: "success" } });
        }
    }
    return ops;
}

// 原节点事务每次编辑调用；视区和拖动不触发提示词重写。
export function reconcileExcelPreviews(previous: CanvasNodeData[], nodes: CanvasNodeData[]) {
    const before = new Map(previous.map(node => [node.id, node]));
    const byId = new Map(nodes.map(node => [node.id, node]));
    return nodes.map(node => {
        const metadata = node.metadata;
        if (metadata?.excelPromptBindingNodeId) {
            const parameter = byId.get(metadata.excelPromptBindingNodeId);
            if (parameter && (rawPrompt(before.get(node.id) || node) !== rawPrompt(node) || parameterChanged(before.get(parameter.id), parameter))) {
                return { ...node, metadata: { ...metadata, excelPromptResolved: resolvedPrompt(node, parameter) } };
            }
        }
        if (!metadata?.promptVariablePreviewOf || !metadata.promptVariableSourceNodeId) return node;
        const source = byId.get(metadata.promptVariableSourceNodeId), parameter = byId.get(metadata.promptVariablePreviewOf);
        if (!source || !parameter) return node;
        const old = before.get(source.id);
        if (old && rawPrompt(old) === rawPrompt(source) && old.title === source.title && !parameterChanged(before.get(parameter.id), parameter)) return node;
        const text = resolvedPrompt(source, parameter);
        return { ...node, title: finalPromptPreviewTitle(source), metadata: { ...metadata, content: text, prompt: text } };
    });
}
