import { nanoid } from "nanoid";
import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { placeCanvasNode } from "../画布布局/卡片自动避让";
import { imageBriefSignature, promptDocument, PRODUCT_PROMPT_NODE_TYPE, type ProductImageBrief, type ProductImagePlan, type ProductPromptMetadata } from "./商品提示词规则";

const configFields = ["model", "size", "count", "quality", "background", "composerContent", "generationMode", "generationPixelWidth", "generationPixelHeight"] as const;
export const productConfigSignature = (node: CanvasNodeData) => JSON.stringify(configFields.map(key => node.metadata?.[key]));
const documentSignature = (node: CanvasNodeData) => {
    const doc = promptDocument(node)!;
    const { parameterId: _parameter, generatedSignature: _signature, ...brief } = doc;
    return imageBriefSignature(brief);
};
export function productImageConfig(brief: ProductImageBrief, model?: string) {
    return { model, size: `${brief.delivery.width}x${brief.delivery.height}`, count: 1,
        generationMode: "image" as const, generationParamsDetected: true,
        generationPixelWidth: brief.delivery.width, generationPixelHeight: brief.delivery.height };
}

export function productPlanOps(parameter: CanvasNodeData, plan: ProductImagePlan, nodes: CanvasNodeData[],
    connections: CanvasConnection[], fingerprint: string, model?: string) {
    const ops: CanvasAgentOp[] = [], occupied = [...nodes], selected: string[] = [];
    let preserved = 0;
    const oldPrompts = nodes.filter(node => promptDocument(node)?.parameterId === parameter.id
        && !(node.metadata as ProductPromptMetadata)?.productPromptRetired);
    const retained = new Set<string>();
    for (const brief of plan.images) {
        const old = oldPrompts.find(node => promptDocument(node)?.key === brief.key);
        const oldConfig = old && nodes.find(node => (node.metadata as ProductPromptMetadata)?.productPromptConfigKey === old.id);
        const untouched = old && documentSignature(old) === promptDocument(old)!.generatedSignature
            && (!oldConfig || productConfigSignature(oldConfig) === (oldConfig.metadata as ProductPromptMetadata).productPromptConfigSignature);
        const id = untouched ? old.id : nanoid();
        const signature = imageBriefSignature(brief);
        const metadata: ProductPromptMetadata = { productImagePrompt: { ...brief, parameterId: parameter.id, generatedSignature: signature },
            productPromptSourceFingerprint: fingerprint, productPromptRetired: false, status: "success" };
        if (untouched) {
            retained.add(old.id);
            ops.push({ type: "update_node", id, patch: { title: brief.name }, metadata });
        } else {
            if (old) preserved++;
            const pair = placeCanvasNode({ id, type: PRODUCT_PROMPT_NODE_TYPE, title: brief.name,
                position: { x: parameter.position.x + parameter.width + 96, y: parameter.position.y },
                width: 876, height: 540 }, occupied);
            occupied.push(pair);
            ops.push({ type: "add_node", id, nodeType: PRODUCT_PROMPT_NODE_TYPE, title: brief.name, position: pair.position,
                width: 440, height: 540, metadata });
        }
        const source = untouched ? old : occupied.find(node => node.id === id)!;
        const configId = untouched && oldConfig ? oldConfig.id : nanoid();
        const config: CanvasNodeData = { id: configId, type: "config", title: `${brief.name} · 生成`,
            position: { x: source.position.x + 536, y: source.position.y + 150 }, width: 340, height: 240,
            metadata: { ...productImageConfig(brief, model), productPromptConfigKey: id, productPromptRetired: false } as ProductPromptMetadata };
        const configMetadata: ProductPromptMetadata = { ...config.metadata, productPromptConfigSignature: productConfigSignature(config) };
        if (untouched && oldConfig) ops.push({ type: "update_node", id: configId, metadata: configMetadata });
        else {
            const placed = placeCanvasNode(config, occupied.filter(node => node.id !== id));
            occupied.push(placed);
            ops.push({ type: "add_node", id: configId, nodeType: "config", title: config.title,
                position: placed.position, width: 340, height: 240, metadata: configMetadata });
        }
        ops.push({ type: "connect_nodes", fromNodeId: parameter.id, toNodeId: id },
            { type: "connect_nodes", fromNodeId: id, toNodeId: configId });
        selected.push(id);
    }
    // 历史结果及手工修改始终保留；旧方案退出批量执行，避免多跑一套。
    if (plan.images.length) for (const old of oldPrompts) {
        if (retained.has(old.id)) continue;
        ops.push({ type: "update_node", id: old.id, metadata: { productPromptRetired: true } as ProductPromptMetadata });
        for (const config of nodes.filter(node => (node.metadata as ProductPromptMetadata)?.productPromptConfigKey === old.id))
            ops.push({ type: "update_node", id: config.id, metadata: { productPromptRetired: true } as ProductPromptMetadata });
    }
    const { images, ...summary } = plan;
    ops.push({ type: "update_node", id: parameter.id, metadata: {
        productImagePlan: { ...summary, imageCount: images.length, updatedAt: new Date().toISOString(), preserved },
    } as ProductPromptMetadata });
    if (selected.length) ops.push({ type: "select_nodes", ids: selected });
    return ops;
}
