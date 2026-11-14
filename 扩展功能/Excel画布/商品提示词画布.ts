import { nanoid } from "nanoid";
import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { placeCanvasNode, placeGeneratedCanvasNode } from "../画布布局/卡片自动避让";
import { imageBriefSignature, productPlanningParameters, productPromptTitle, promptDocument, PRODUCT_PROMPT_NODE_TYPE, type ProductImageBrief, type ProductImagePlan, type ProductPromptMetadata } from "./商品提示词规则";
import { mergeProductVariantPrompts, sharedProductPromptOps } from "./共用商品提示词";

const configFields = ["model", "size", "count", "quality", "background", "composerContent", "generationMode", "generationPixelWidth", "generationPixelHeight"] as const;
export const productConfigSignature = (node: CanvasNodeData) => JSON.stringify(configFields.map(key => node.metadata?.[key]));
export function productImageConfig(brief: ProductImageBrief, model?: string) {
    return { model, size: `${brief.delivery.width}x${brief.delivery.height}`, count: 1,
        generationMode: "image" as const, generationParamsDetected: true,
        generationPixelWidth: brief.delivery.width, generationPixelHeight: brief.delivery.height };
}

export function productPlanOps(parameter: CanvasNodeData, plan: ProductImagePlan, nodes: CanvasNodeData[],
    connections: CanvasConnection[], fingerprint: string, model?: string) {
    const merged = mergeProductVariantPrompts(parameter, nodes, connections);
    const ops: CanvasAgentOp[] = sharedProductPromptOps(nodes, connections, merged), selected: string[] = [];
    if (merged) { nodes = merged.nodes; connections = merged.connections; }
    const oldPrompts = nodes.filter(node => promptDocument(node)?.parameterId === parameter.id).sort((a, b) =>
            Number(Boolean((a.metadata as ProductPromptMetadata).productPromptRetired)) - Number(Boolean((b.metadata as ProductPromptMetadata).productPromptRetired)));
    const requestedSlots = new Set(plan.images.map(brief => brief.key));
    const reserved = new Set(oldPrompts.filter(node => requestedSlots.has(promptDocument(node)!.key)).map(node => node.id));
    const occupied = [...nodes];
    let nextY = parameter.position.y + (parameter.height - 540) / 2;
    const retained = new Set<string>();
    const kindOrder = { main: 0, carousel: 1, rich: 2 };
    const briefs = plan.images.map((brief, planIndex) => ({ brief, planIndex }))
        .sort((a, b) => kindOrder[a.brief.kind] - kindOrder[b.brief.kind] || a.planIndex - b.planIndex);
    for (const [rowIndex, { brief, planIndex }] of briefs.entries()) {
        const document = brief;
        const title = productPromptTitle(document, plan.images);
        const old = oldPrompts.find(node => !retained.has(node.id) && promptDocument(node)?.key === brief.key
            && !promptDocument(node)?.variantId)
            || oldPrompts.filter(node => !retained.has(node.id) && !reserved.has(node.id) && !promptDocument(node)?.variantId)
                .sort((a, b) => Number(promptDocument(b)?.kind === brief.kind) - Number(promptDocument(a)?.kind === brief.kind))[0];
        const oldConfig = old && nodes.find(node => (node.metadata as ProductPromptMetadata)?.productPromptConfigKey === old.id);
        const id = old ? old.id : nanoid();
        const signature = imageBriefSignature(document);
        const metadata: ProductPromptMetadata = { ...old?.metadata, productImagePrompt: { ...document, planIndex, parameterId: parameter.id, generatedSignature: signature },
            productPromptSourceFingerprint: fingerprint, productPromptRetired: false, status: "success" };
        const pair = old || (rowIndex === 0 ? placeGeneratedCanvasNode : placeCanvasNode)({
            id, type: PRODUCT_PROMPT_NODE_TYPE, title,
            position: { x: parameter.position.x + parameter.width + 96, y: nextY }, width: 876, height: 540,
        }, occupied);
        nextY = Math.max(nextY, pair.position.y + 588);
        if (old) {
            retained.add(old.id);
            ops.push({ type: "update_node", id, patch: { title }, metadata });
        } else {
            ops.push({ type: "add_node", id, nodeType: PRODUCT_PROMPT_NODE_TYPE, title, position: pair.position,
                width: 440, height: 540, metadata });
        }
        occupied.push(pair);
        const source = pair;
        const configId = oldConfig ? oldConfig.id : nanoid();
        const config: CanvasNodeData = { id: configId, type: "config", title: `${title} · 生图`,
            position: oldConfig ? oldConfig.position : { x: source.position.x + 536, y: source.position.y + 150 }, width: 340, height: 240,
            metadata: { ...oldConfig?.metadata, ...productImageConfig(brief, oldConfig?.metadata?.model || model),
                count: oldConfig?.metadata?.count ?? 1,
                productPromptConfigKey: id, productPromptRetired: false } as ProductPromptMetadata };
        const configMetadata: ProductPromptMetadata = { ...config.metadata, productPromptConfigSignature: productConfigSignature(config) };
        if (oldConfig) ops.push({ type: "update_node", id: configId,
            patch: { title: config.title }, metadata: configMetadata });
        else {
            ops.push({ type: "add_node", id: configId, nodeType: "config", title: config.title,
                position: config.position, width: 340, height: 240, metadata: configMetadata });
        }
        ops.push({ type: "connect_nodes", fromNodeId: parameter.id, toNodeId: id },
            { type: "connect_nodes", fromNodeId: id, toNodeId: configId });
        selected.push(id);
    }
    // 用户重新策划时覆盖原卡；不再需要的用途退出执行，历史生成结果保留。
    if (plan.images.length) for (const old of oldPrompts) {
        if (retained.has(old.id)) continue;
        ops.push({ type: "update_node", id: old.id, metadata: { productPromptRetired: true } as ProductPromptMetadata });
        for (const config of nodes.filter(node => (node.metadata as ProductPromptMetadata)?.productPromptConfigKey === old.id))
            ops.push({ type: "update_node", id: config.id, metadata: { productPromptRetired: true } as ProductPromptMetadata });
    }
    const { images, ...summary } = plan;
    ops.push({ type: "update_node", id: parameter.id, metadata: {
        productImagePlan: { ...summary, imageCount: selected.length,
            updatedAt: new Date().toISOString(), preserved: 0,
            source: { fingerprint, parameters: productPlanningParameters(parameter.metadata || {}) } },
    } as ProductPromptMetadata });
    if (selected.length) ops.push({ type: "select_nodes", ids: selected });
    return ops;
}

export function compactProductPromptTitles(parameter: CanvasNodeData, nodes: CanvasNodeData[]) {
    const ops: CanvasAgentOp[] = [];
    const siblings = nodes.flatMap(node => {
        const doc = promptDocument(node);
        return doc?.parameterId === parameter.id && !(node.metadata as ProductPromptMetadata).productPromptRetired ? [doc] : [];
    });
    for (const node of nodes) {
        const doc = promptDocument(node);
        if (doc?.parameterId !== parameter.id) continue;
        const title = productPromptTitle(doc, siblings);
        if (node.title === doc.name && node.title !== title) ops.push({ type: "update_node", id: node.id, patch: { title } });
        for (const config of nodes.filter(item => (item.metadata as ProductPromptMetadata)?.productPromptConfigKey === node.id)) {
            if (config.title === `${doc.name} · 生成`) ops.push({ type: "update_node", id: config.id, patch: { title: `${title} · 生图` } });
        }
    }
    return ops;
}

export function mergeLegacyProductPrompts(parameter: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const merged = mergeProductVariantPrompts(parameter, nodes, connections);
    return sharedProductPromptOps(nodes, connections, merged);
}
