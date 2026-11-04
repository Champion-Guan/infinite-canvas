import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { getGenerationResourceNodes, getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import type { ProductVariantMetadata } from "./产品变体规则";
import { planningFingerprint, promptDocument, readProductPrompt, validateEnglishPrompt, type ProductPromptMetadata } from "./商品提示词规则";

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
        if ((node.metadata as ProductPromptMetadata).productPromptRetired)
            throw Error(`“${node.title}”属于旧方案，请使用最新策划卡片。`);
        const parameter = nodes.find(item => item.id === promptDocument(node)!.parameterId);
        if (!parameter) throw Error(`“${node.title}”的产品参数卡已移除。`);
        if (planningFingerprint(parameter.metadata as ProductVariantMetadata) !== (node.metadata as ProductPromptMetadata).productPromptSourceFingerprint)
            throw Error(`“${node.title}”的商品资料或参考图已更改，请重新策划后生成。`);
        validateEnglishPrompt(readProductPrompt(node, variantId));
    }
    return inputs;
}
