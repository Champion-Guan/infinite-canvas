import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { getNodeSpec } from "@/constant/canvas";
import { promptDocument } from "../Excel画布/商品提示词规则";
import { productPromptInputs, validateProductPromptInputs } from "../Excel画布/商品提示词输入";
import { productVariantConfigNode } from "../Excel画布/共用商品提示词";
import { planBatchResultColumn } from "../画布布局/批量结果排布";
import { productVariantExecutions, type ProductGenerationJob } from "./产品变体生成";

export type SingleVariantGenerationRequest = { promptNodeId: string; variantId?: string; onSubmitted?: () => void };
type Generate = (request: SingleVariantGenerationRequest) => Promise<void>;
const generators = new Map<string, Generate>();

export function registerSingleVariantGeneration(productId: string, generate: Generate) {
    generators.set(productId, generate);
    return () => { if (generators.get(productId) === generate) generators.delete(productId); };
}

export async function generateSingleProductVariant(productId: string, request: SingleVariantGenerationRequest) {
    const generate = generators.get(productId);
    if (!generate) throw Error("画布尚未就绪，请稍后重试。");
    await generate(request);
}

export function planSingleProductVariantJob(request: SingleVariantGenerationRequest, nodes: CanvasNodeData[],
    connections: CanvasConnection[], batchId: string): ProductGenerationJob {
    const prompt = nodes.find(node => node.id === request.promptNodeId), doc = promptDocument(prompt);
    if (!prompt || !doc) throw Error("商品提示词卡片已移除，请重新选择。");
    const variantId = doc.variantId || request.variantId;
    if (doc.variantId && request.variantId && doc.variantId !== request.variantId)
        throw Error("当前卡片不属于所选变体，请重新选择。");
    if (Object.keys(doc.variants).length && (!variantId || !doc.variants[variantId]))
        throw Error("当前变体提示词不存在，请重新策划。");
    const connectedIds = new Set(connections.filter(edge => edge.fromNodeId === prompt.id).map(edge => edge.toNodeId));
    const configs = nodes.filter(node => connectedIds.has(node.id) && node.type === "config"
        && (node.metadata?.generationMode || "image") === "image");
    if (!configs.length) throw Error("请先为当前提示词连接一个生图配置。");
    if (configs.length > 1) throw Error("当前提示词连接了多个生图配置，请保留一个后再生成。");
    const config = configs[0], inputs = productPromptInputs(config.id, nodes, connections);
    if (inputs.length !== 1 || inputs[0].id !== prompt.id)
        throw Error("请让生图配置仅引用当前商品提示词卡片。");
    const executions = productVariantExecutions(config.id, nodes, connections, variantId);
    if (executions.length > 1) throw Error("请选择要生成的变体。");
    validateProductPromptInputs(config.id, nodes, connections, variantId);
    const execution = executions[0], source = productVariantConfigNode(config, variantId)!;
    const spec = getNodeSpec("image");
    const placement = planBatchResultColumn([{ source, width: spec.width, height: spec.height }], nodes, batchId).get(source.id)!;
    return { source, mode: "image", prompt: source.metadata?.composerContent || source.metadata?.prompt || "",
        placement: { ...placement, ...(execution ? { productVariant: execution } : {}) } };
}
