import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { getGenerationCount } from "@/lib/canvas/canvas-generation-helpers";
import { generationProductParameters, generationPromptVariantId } from "./产品变体生成";
import { productVariants, variantLabel } from "../Excel画布/产品变体规则";
import { productVariantConfigNode } from "../Excel画布/共用商品提示词";
import { generationNodeForExecution } from "./生成参数继承";

export type VariantImageCount = {
    variants: Array<{ id: string; name: string; count: number }>;
    perVariant: number | null;
    total: number;
    error?: string;
};
export function variantImageCount(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], fallback?: string): VariantImageCount | undefined {
    if ((node.metadata?.generationMode || "image") !== "image") return undefined;
    const parameters = generationProductParameters(node.id, nodes, connections);
    if (!parameters.some(parameter => productVariants(parameter.metadata).length)) return undefined;
    try {
        if (parameters.length !== 1) throw Error("一个生成配置只能使用一张产品参数卡");
        const bound = generationPromptVariantId(node.id, nodes, connections);
        const all = productVariants(parameters[0].metadata);
        if (bound && !all.some(variant => variant.id === bound)) throw Error("提示词对应的变体已移除");
        const selected = all.filter(variant => variant.enabled && (!bound || bound === variant.id));
        if (!selected.length) throw Error("请至少勾选一个生成变体");
        const source = generationNodeForExecution(node, node.id, nodes, connections);
        const variants = selected.map(variant => ({
            id: variant.id, name: variantLabel(variant),
            count: getGenerationCount(String(productVariantConfigNode(source, variant.id)?.metadata?.count || fallback || 1)),
        }));
        const counts = new Set(variants.map(variant => variant.count));
        return { variants, perVariant: counts.size === 1 ? variants[0].count : null,
            total: variants.reduce((total, variant) => total + variant.count, 0) };
    } catch (error) {
        return { variants: [], perVariant: null, total: 0,
            error: error instanceof Error ? error.message : "生成变体尚未就绪" };
    }
}
export function variantImageCountText(summary: VariantImageCount) {
    if (summary.error) return summary.error;
    return summary.perVariant === null
        ? `${summary.variants.length} 个变体，共 ${summary.total} 张（各变体张数不同）`
        : `${summary.variants.length} 个变体 × 每个 ${summary.perVariant} 张 = 共 ${summary.total} 张`;
}

type ArchivedCounts = CanvasNodeMetadata & { productPromptVariantConfigs?: {
    base: Record<string, unknown>; variants: Record<string, Record<string, unknown>>;
} };
// An explicit count selection replaces archived counts even when the user picks
// the same value as the shared card's original count.
export function sharedImageCountPatch(node: CanvasNodeData, patch: Partial<CanvasNodeMetadata> | undefined): Partial<CanvasNodeMetadata> | undefined {
    const saved = (node.metadata as ArchivedCounts | undefined)?.productPromptVariantConfigs;
    if (!patch || !saved || !Object.hasOwn(patch, "count") || !Object.values(saved.variants).some(value => Object.hasOwn(value, "count"))) return patch;
    return { ...patch, productPromptVariantConfigs: { ...saved,
        variants: Object.fromEntries(Object.entries(saved.variants).map(([id, value]) => [
            id, Object.fromEntries(Object.entries(value).filter(([key]) => key !== "count")),
        ])),
    } } as Partial<ArchivedCounts>;
}
