import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { getGenerationResourceNodes, getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { promptDocument } from "./商品提示词规则";
import { productPromptProblems } from "./商品提示词状态";
import { ProductPromptBlockedError } from "./商品提示词阻止反馈";

export function productPromptInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const source = nodes.find(node => node.id === nodeId);
    const composer = source?.type === "config" ? source.metadata?.composerContent?.trim() : "";
    const mentions = composer ? new Set([...composer.matchAll(/@\[node:([^\]]+)\]/g)].map(match => match[1])) : null;
    const inputs = getGenerationResourceNodes(nodeId, nodes, connections).filter(node => !mentions || mentions.has(node.id));
    return [...new Map(inputs.flatMap(node => node.type === "group" ? getGroupResourceNodes(node.id, nodes) : [node])
        .filter(node => promptDocument(node)).map(node => [node.id, node])).values()];
}

export function validateProductPromptInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], variantId?: string) {
    const inputs = productPromptInputs(nodeId, nodes, connections);
    if (new Set(inputs.map(node => promptDocument(node)!.parameterId)).size > 1)
        throw Error("一个生成配置只能使用一个产品的提示词，请分开不同产品的连线。");
    for (const node of inputs) {
        const parameter = nodes.find(item => item.id === promptDocument(node)!.parameterId);
        const reasons = productPromptProblems(node, parameter, variantId);
        if (reasons.length) throw new ProductPromptBlockedError(`“${node.title}”提示词已失效：${reasons.join("\n")}`, [node.id]);
    }
    return inputs;
}
