import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { promptDocument, promptPair, type ProductPromptMetadata } from "./商品提示词规则";
import { placeCanvasNode } from "../画布布局/卡片自动避让";

const editingVariants = new Map<string, string>();
export function productPromptEditingVariant(node: CanvasNodeData) {
    const doc = promptDocument(node);
    if (!doc) return undefined;
    const selected = editingVariants.get(node.id);
    return doc.variantId || (selected && doc.variants[selected] ? selected : Object.keys(doc.variants)[0]);
}
export function selectProductPromptVariant(nodeId: string, variantId: string) {
    editingVariants.delete(nodeId);
    editingVariants.set(nodeId, variantId);
    if (editingVariants.size > 256) editingVariants.delete(editingVariants.keys().next().value!);
}

const configKeys = ["model", "channel", "channelId", "size", "count", "quality", "moderation", "background", "reasoningEffort",
    "generationMode", "generationPixelWidth", "generationPixelHeight", "generationAspectRatio", "generationParamsDetected"] as const;
const configSettings = (node: CanvasNodeData) => Object.fromEntries(configKeys.map(key => [key, node.metadata?.[key]]));
type VariantConfigs = { base: Record<string, unknown>; variants: Record<string, Record<string, unknown>> };
type SharedMetadata = ProductPromptMetadata & {
    productPromptVariantConfigs?: VariantConfigs;
    productPromptMergeArchive?: string;
};

// 合并前的变体差异配置继续生效；用户修改共用字段后，该字段统一采用新值。
export function productVariantConfigNode(node: CanvasNodeData | undefined, variantId?: string) {
    const saved = (node?.metadata as SharedMetadata | undefined)?.productPromptVariantConfigs;
    const variant = variantId && saved?.variants[variantId];
    if (!node || !saved || !variant) return node;
    const patch = Object.fromEntries(Object.entries(variant).filter(([key]) =>
        JSON.stringify(node.metadata?.[key as keyof CanvasNodeMetadata]) === JSON.stringify(saved.base[key])));
    return { ...node, metadata: { ...node.metadata, ...patch } };
}

/** 同用途卡合并为一张，保留各变体文案、原配置及历史结果，不发送生成请求。 */
export function mergeProductVariantPrompts(parameter: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const active = nodes.filter(node => promptDocument(node)?.parameterId === parameter.id
        && !(node.metadata as ProductPromptMetadata).productPromptRetired);
    if (!active.some(node => promptDocument(node)?.variantId)) return null;
    const groups = new Map<string, CanvasNodeData[]>();
    for (const node of active) {
        const doc = promptDocument(node)!;
        const key = JSON.stringify([doc.key, (node.metadata as ProductPromptMetadata).productPromptSourceFingerprint]);
        groups.set(key, [...groups.get(key) || [], node]);
    }
    const remapped = new Map<string, string>(), replacements = new Map<string, CanvasNodeData>();
    const allConfigs = nodes.filter(node => node.type === "config");
    for (const group of groups.values()) {
        if (!group.some(node => promptDocument(node)?.variantId)) continue;
        const configs = allConfigs.filter(node => group.some(prompt => prompt.id === (node.metadata as ProductPromptMetadata)?.productPromptConfigKey));
        const members = new Set([...group, ...configs].map(node => node.id));
        if (nodes.some(node => node.metadata?.status === "loading" && (members.has(node.id)
            || connections.some(edge => members.has(edge.fromNodeId) && edge.toNodeId === node.id)))) continue;
        const primary = group.find(node => !promptDocument(node)!.variantId) || group[0];
        const doc = promptDocument(primary)!;
        const pairs = { ...(!doc.variantId ? doc.variants : {}) };
        for (const node of group) {
            const source = promptDocument(node)!;
            if (source.variantId) pairs[source.variantId] = promptPair(source, source.variantId)!;
            else Object.assign(pairs, source.variants);
            remapped.set(node.id, primary.id);
        }
        const { variantId: _variant, variantName: _name, planName, ...shared } = doc;
        const title = planName || doc.name;
        const config = configs.find(item => (item.metadata as ProductPromptMetadata).productPromptConfigKey === primary.id) || configs[0];
        replacements.set(primary.id, { ...primary, title, metadata: { ...primary.metadata,
            productImagePrompt: { ...shared, name: title, prompt: doc.prompt, variants: pairs },
            // 原卡片存为独立JSON文本，避免再次展开类型树而突破整份应用状态的嵌套边界。
            productPromptMergeArchive: JSON.stringify({ nodes: [...group, ...configs],
                connections: connections.filter(edge => members.has(edge.fromNodeId) || members.has(edge.toNodeId)) },
                (_key, value) => typeof value === "string" && value.startsWith("blob:") ? undefined : value),
        } as SharedMetadata });
        if (config) {
            const variants: VariantConfigs["variants"] = {};
            for (const old of configs) {
                const owner = group.find(node => node.id === (old.metadata as ProductPromptMetadata).productPromptConfigKey);
                const variant = owner && promptDocument(owner)?.variantId;
                if (variant) variants[variant] = configSettings(old);
                remapped.set(old.id, config.id);
            }
            replacements.set(config.id, { ...config, title: `${title} · 生图`, metadata: { ...config.metadata,
                productPromptConfigKey: primary.id, productPromptVariantConfigs: { base: configSettings(config), variants },
            } as SharedMetadata });
        }
    }
    if (!replacements.size) return null;
    const idFields = new Set(["productPromptConfigKey", "generationParamsSourceNodeId", "promptVariableSourceNodeId",
        "promptVariablePreviewNodeId", "promptVariablePreviewOf", "promptVariableEnglishPreviewOf", "promptVariableTranslationOf", "excelPromptBindingNodeId"]);
    const rewrite = (metadata: CanvasNodeMetadata | undefined) => metadata && Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
        key, idFields.has(key) && typeof value === "string" ? remapped.get(value) || value
            : key === "composerContent" && typeof value === "string" ? value.replace(/@\[node:([^\]]+)\]/g,
                (mention, id: string) => remapped.has(id) ? `@[node:${remapped.get(id)}]` : mention) : value,
    ])) as CanvasNodeMetadata;
    let next = nodes.filter(node => !remapped.has(node.id) || remapped.get(node.id) === node.id).map(node => {
        const replacement = replacements.get(node.id) || node;
        const metadata = rewrite(replacement.metadata);
        return JSON.stringify(metadata) === JSON.stringify(node.metadata) && replacement === node ? node : { ...replacement, metadata };
    });
    const seen = new Set<string>(), nextConnections: CanvasConnection[] = [];
    for (const edge of connections) {
        const fromNodeId = remapped.get(edge.fromNodeId) || edge.fromNodeId, toNodeId = remapped.get(edge.toNodeId) || edge.toNodeId;
        const key = JSON.stringify([fromNodeId, toNodeId]);
        if (fromNodeId === toNodeId || seen.has(key)) continue;
        seen.add(key);
        nextConnections.push(fromNodeId === edge.fromNodeId && toNodeId === edge.toNodeId ? edge : { ...edge, fromNodeId, toNodeId });
    }
    const prompts = next.filter(node => replacements.has(node.id) && promptDocument(node)).sort((a, b) => a.position.y - b.position.y);
    const moving = new Set(replacements.keys()), occupied = next.filter(node => !moving.has(node.id));
    const positions = new Map<string, CanvasNodeData["position"]>();
    let y = prompts[0]?.position.y || 0;
    for (const prompt of prompts) {
        const config = next.find(node => node.type === "config" && (node.metadata as ProductPromptMetadata)?.productPromptConfigKey === prompt.id);
        const row = placeCanvasNode({ ...prompt, width: prompt.width + (config ? 96 + config.width : 0),
            position: { x: prompt.position.x, y } }, occupied);
        positions.set(prompt.id, row.position);
        if (config) positions.set(config.id, { x: row.position.x + prompt.width + 96, y: row.position.y + (prompt.height - config.height) / 2 });
        occupied.push(row);
        y = row.position.y + Math.max(prompt.height, config?.height || 0) + 48;
    }
    next = next.map(node => {
        if (node.id === parameter.id) {
            const metadata = node.metadata as ProductPromptMetadata;
            return metadata.productImagePlan ? { ...node, metadata: { ...metadata, productImagePlan: { ...metadata.productImagePlan,
                imageCount: next.filter(item => promptDocument(item)?.parameterId === parameter.id && !(item.metadata as ProductPromptMetadata).productPromptRetired).length } } } : node;
        }
        return positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node;
    });
    return { nodes: next, connections: nextConnections };
}

export function sharedProductPromptOps(before: CanvasNodeData[], connections: CanvasConnection[],
    next: { nodes: CanvasNodeData[]; connections: CanvasConnection[] } | null): CanvasAgentOp[] {
    if (!next) return [];
    const kept = new Set(next.nodes.map(node => node.id));
    const ops: CanvasAgentOp[] = next.nodes.filter(node => before.find(old => old.id === node.id) !== node).map(node => ({
        type: "update_node", id: node.id, patch: { title: node.title, position: node.position }, metadata: node.metadata,
    }));
    const deletedEdges = connections.filter(edge => !next.connections.includes(edge));
    if (deletedEdges.length) ops.push({ type: "delete_connections", ids: deletedEdges.map(edge => edge.id) });
    for (const edge of next.connections) if (!connections.includes(edge))
        ops.push({ type: "connect_nodes", ...edge });
    const removed = before.filter(node => !kept.has(node.id)).map(node => node.id);
    if (removed.length) ops.push({ type: "delete_node", ids: removed });
    return ops;
}
