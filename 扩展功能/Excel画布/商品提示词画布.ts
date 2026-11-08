import { nanoid } from "nanoid";
import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { placeCanvasNode } from "../画布布局/卡片自动避让";
import { imageBriefSignature, productPlanningParameters, productPromptTitle, promptDocument, PRODUCT_PROMPT_NODE_TYPE, type ProductImageBrief, type ProductImagePlan, type ProductPromptMetadata } from "./商品提示词规则";
import { productVariants, variantLabel } from "./产品变体规则";

const configFields = ["model", "size", "count", "quality", "background", "composerContent", "generationMode", "generationPixelWidth", "generationPixelHeight"] as const;
export const productConfigSignature = (node: CanvasNodeData) => JSON.stringify(configFields.map(key => node.metadata?.[key]));
export function productImageConfig(brief: ProductImageBrief, model?: string) {
    return { model, size: `${brief.delivery.width}x${brief.delivery.height}`, count: 1,
        generationMode: "image" as const, generationParamsDetected: true,
        generationPixelWidth: brief.delivery.width, generationPixelHeight: brief.delivery.height };
}

export function productPlanOps(parameter: CanvasNodeData, plan: ProductImagePlan, nodes: CanvasNodeData[],
    connections: CanvasConnection[], fingerprint: string, model?: string, migrateIds?: Set<string>) {
    const ops: CanvasAgentOp[] = [], selected: string[] = [];
    const oldPrompts = nodes.filter(node => promptDocument(node)?.parameterId === parameter.id
        && (!migrateIds || migrateIds.has(node.id))).sort((a, b) =>
            Number(Boolean((a.metadata as ProductPromptMetadata).productPromptRetired)) - Number(Boolean((b.metadata as ProductPromptMetadata).productPromptRetired)));
    const slotKey = (key: string, variantId?: string) => JSON.stringify([key, variantId || ""]);
    const requestedSlots = new Set(plan.images.flatMap(brief => (Object.keys(brief.variants).length ? Object.keys(brief.variants) : [undefined])
        .map(variantId => slotKey(brief.key, variantId))));
    const reserved = new Set(oldPrompts.filter(node => requestedSlots.has(slotKey(promptDocument(node)!.key, promptDocument(node)!.variantId))).map(node => node.id));
    const replacing = new Set(oldPrompts.flatMap(node => [node.id,
        ...nodes.filter(config => (config.metadata as ProductPromptMetadata)?.productPromptConfigKey === node.id).map(config => config.id)]));
    const occupied = migrateIds ? nodes.filter(node => !replacing.has(node.id)) : [...nodes];
    const variants = productVariants(parameter.metadata);
    let nextY = parameter.position.y;
    const retained = new Set<string>();
    for (const brief of plan.images) {
      const ids = Object.keys(brief.variants);
      const ordered = [...variants.filter(variant => ids.includes(variant.id)).map(variant => variant.id),
          ...ids.filter(id => !variants.some(variant => variant.id === id))];
      for (const [index, variantId] of (ordered.length ? ordered : [undefined]).entries()) {
        const variantName = variantId ? variants.find(variant => variant.id === variantId) : undefined;
        const name = variantName ? variantLabel(variantName) : variantId;
        const document = variantId ? { ...brief, name: `${name} · ${brief.name}`, planName: brief.name,
            prompt: brief.variants[variantId], variants: { [variantId]: brief.variants[variantId] }, variantId, variantName: name } : brief;
        const title = productPromptTitle(document, plan.images);
        const matchesVariant = (node: CanvasNodeData) => promptDocument(node)?.variantId === variantId;
        const old = oldPrompts.find(node => !retained.has(node.id) && promptDocument(node)?.key === brief.key
            && (matchesVariant(node) || Boolean(migrateIds && index === 0 && !promptDocument(node)?.variantId)))
            || (!migrateIds ? oldPrompts.filter(node => !retained.has(node.id) && !reserved.has(node.id) && matchesVariant(node))
                .sort((a, b) => Number(promptDocument(b)?.kind === brief.kind) - Number(promptDocument(a)?.kind === brief.kind))[0] : undefined);
        const oldConfig = old && nodes.find(node => (node.metadata as ProductPromptMetadata)?.productPromptConfigKey === old.id);
        const id = old ? old.id : nanoid();
        const signature = imageBriefSignature(document);
        const metadata: ProductPromptMetadata = { ...old?.metadata, productImagePrompt: { ...document, parameterId: parameter.id, generatedSignature: signature },
            productPromptSourceFingerprint: fingerprint, productPromptRetired: false, status: "success" };
        const pair = old && !migrateIds ? old : placeCanvasNode({
            id, type: PRODUCT_PROMPT_NODE_TYPE, title,
            position: { x: parameter.position.x + parameter.width + 96, y: nextY }, width: 876, height: 540,
        }, occupied);
        nextY = Math.max(nextY, pair.position.y + 588);
        if (old) {
            retained.add(old.id);
            ops.push({ type: "update_node", id, patch: { title, ...(migrateIds ? { position: pair.position } : {}) }, metadata });
        } else {
            ops.push({ type: "add_node", id, nodeType: PRODUCT_PROMPT_NODE_TYPE, title, position: pair.position,
                width: 440, height: 540, metadata });
        }
        occupied.push(pair);
        const source = pair;
        const configId = oldConfig ? oldConfig.id : nanoid();
        const config: CanvasNodeData = { id: configId, type: "config", title: `${title} · 生图`,
            position: oldConfig && !migrateIds ? oldConfig.position : { x: source.position.x + 536, y: source.position.y + 150 }, width: 340, height: 240,
            metadata: { ...oldConfig?.metadata, ...productImageConfig(brief, oldConfig?.metadata?.model || model),
                count: oldConfig?.metadata?.count ?? 1,
                productPromptConfigKey: id, productPromptRetired: false } as ProductPromptMetadata };
        const configMetadata: ProductPromptMetadata = { ...config.metadata, productPromptConfigSignature: productConfigSignature(config) };
        if (oldConfig) ops.push({ type: "update_node", id: configId,
            patch: { title: config.title, ...(migrateIds ? { position: config.position } : {}) }, metadata: configMetadata });
        else {
            ops.push({ type: "add_node", id: configId, nodeType: "config", title: config.title,
                position: config.position, width: 340, height: 240, metadata: configMetadata });
        }
        ops.push({ type: "connect_nodes", fromNodeId: parameter.id, toNodeId: id },
            { type: "connect_nodes", fromNodeId: id, toNodeId: configId });
        selected.push(id);
      }
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
        productImagePlan: { ...summary, imageCount: selected.length + (migrateIds ? nodes.filter(node =>
            promptDocument(node)?.parameterId === parameter.id && !migrateIds.has(node.id) && !(node.metadata as ProductPromptMetadata).productPromptRetired).length : 0),
            updatedAt: new Date().toISOString(), preserved: 0, source: migrateIds
                ? (parameter.metadata as ProductPromptMetadata)?.productImagePlan?.source
                : { fingerprint, parameters: productPlanningParameters(parameter.metadata || {}) } },
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

export function expandLegacyProductPrompts(parameter: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const legacy = nodes.filter(node => promptDocument(node)?.parameterId === parameter.id
        && !promptDocument(node)?.variantId && Object.keys(promptDocument(node)!.variants).length
        && !(node.metadata as ProductPromptMetadata).productPromptRetired);
    if (!legacy.length) return [];
    const summary = (parameter.metadata as ProductPromptMetadata)?.productImagePlan;
    const firstConfig = nodes.find(node => (node.metadata as ProductPromptMetadata)?.productPromptConfigKey === legacy[0].id);
    const plan: ProductImagePlan = { overview: summary?.overview || { buyers: "", sellingPoints: "", concerns: "", consistency: "", sequence: "" },
        style: summary?.style || "", assumptions: summary?.assumptions || [], pendingFacts: summary?.pendingFacts || [],
        images: legacy.map(node => {
            const { parameterId: _parameter, generatedSignature: _signature, ...brief } = promptDocument(node)!;
            return brief;
        }) };
    return productPlanOps(parameter, plan, nodes, connections,
        (legacy[0].metadata as ProductPromptMetadata).productPromptSourceFingerprint || "", firstConfig?.metadata?.model,
        new Set(legacy.map(node => node.id)));
}
