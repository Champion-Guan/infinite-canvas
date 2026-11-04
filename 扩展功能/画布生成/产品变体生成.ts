import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { getNodeSpec } from "@/constant/canvas";
import { getGenerationCount } from "@/lib/canvas/canvas-generation-helpers";
import { productMainImages } from "../Excel画布/产品主图规则";
import { productParameterSupplement } from "../Excel画布/旧版参数规则";
import { productVariants, variantImages, variantLabel, variantParameterMetadata, type ProductVariantMetadata } from "../Excel画布/产品变体规则";
import { resolvePromptVariables } from "../提示词/变量使用规则";
import { planBatchResultColumn, type BatchResultPlacement } from "../画布布局/批量结果排布";
import type { CanvasGenerationRequest } from "./并发生成状态";
import { promptDocument } from "../Excel画布/商品提示词规则";
import { validateProductPromptInputs } from "../Excel画布/商品提示词输入";

export type ProductVariantSnapshot = { parameterId: string; id: string; name: string; attributes: Record<string, string> };
export type ProductVariantExecution = {
    snapshot: ProductVariantSnapshot;
    parameterMetadata: ProductVariantMetadata;
};
export type ProductGenerationJob = {
    source: CanvasNodeData;
    mode: "image" | "text" | "video" | "audio";
    prompt: string;
    placement: BatchResultPlacement;
};

// 只追溯真正参与本配置的输入，停止在媒体节点，避免经旧结果串到其他产品。
export function generationProductParameters(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const incoming = new Map<string, string[]>();
    for (const connection of connections) incoming.set(connection.toNodeId, [...incoming.get(connection.toNodeId) || [], connection.fromNodeId]);
    const queue = [nodeId], visited = new Set<string>(), parameters = new Map<string, CanvasNodeData>();
    while (queue.length) {
        const id = queue.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = byId.get(id);
        if (!node) continue;
        if (node.type === "guan:prompt-variables") { parameters.set(id, node); continue; }
        const document = promptDocument(node);
        if (document) { queue.push(document.parameterId); continue; }
        if (!["config", "text", "group"].includes(node.type)) continue;
        const metadata = node.metadata;
        for (const bound of [metadata?.excelPromptBindingNodeId, metadata?.promptVariablePreviewOf, metadata?.promptVariableSourceNodeId]) if (bound) queue.push(bound);
        if (node.type === "group") {
            for (const child of nodes) if (child.metadata?.groupId === id) queue.push(child.id);
        }
        const inputs = incoming.get(id) || [];
        const composer = node.type === "config" ? metadata?.composerContent?.trim() : "";
        const mentions = composer ? new Set([...composer.matchAll(/@\[node:([^\]]+)\]/g)].map(match => match[1])) : null;
        queue.push(...inputs.filter(input => !mentions || mentions.has(input)));
    }
    return [...parameters.values()];
}

export function productVariantExecutions(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): ProductVariantExecution[] {
    const parameters = generationProductParameters(nodeId, nodes, connections);
    const variantParameters = parameters.filter(node => productVariants(node.metadata).length);
    if (!variantParameters.length) return [];
    if (parameters.length !== 1) throw Error("一个生成配置只能使用一张产品参数卡，请先分开不同产品的连线。");
    const parameter = variantParameters[0], metadata = parameter.metadata as ProductVariantMetadata;
    const selected = productVariants(metadata).filter(variant => variant.enabled);
    if (!selected.length) throw Error("请在产品参数卡中至少勾选一个变体。");
    const pool = new Map(productMainImages(metadata).map(image => [image.id, image]));
    const names = new Set<string>(), ids = new Set<string>();
    return selected.map(variant => {
        const name = variantLabel(variant);
        if (name === "未命名变体") throw Error("请填写变体名称或颜色、尺寸等属性。");
        if (names.has(name) || ids.has(variant.id)) throw Error(`变体“${name}”重复，请使用不同名称。`);
        names.add(name); ids.add(variant.id);
        if (!variant.imageIds.length) throw Error(`请先为变体“${name}”分配产品主图。`);
        if ([...variant.imageIds, ...metadata.productSharedImageIds || []].some(id => !pool.has(id))) {
            throw Error(`变体“${name}”的图片已被移除，请重新分配。`);
        }
        const references = variantImages(metadata, variant);
        if (references.some(image => !image.storageKey && (!image.url || image.url.startsWith("blob:")))) {
            throw Error(`变体“${name}”有未保存的图片，请重新上传后生成。`);
        }
        return {
            snapshot: { parameterId: parameter.id, id: variant.id, name, attributes: { ...variant.attributes } },
            parameterMetadata: structuredClone(variantParameterMetadata(metadata, variant)),
        };
    });
}

export function variantScopedNodes(nodes: CanvasNodeData[], execution?: ProductVariantExecution) {
    return execution ? nodes.map(node => node.id === execution.snapshot.parameterId ? { ...node, metadata: execution.parameterMetadata } : node) : nodes;
}

export function variantInputPrompt(prompt: string, execution?: ProductVariantExecution) {
    return execution ? resolvePromptVariables(prompt, execution.parameterMetadata.promptVariableValues) : prompt;
}

export function variantGenerationContext(context: NodeGenerationContext, execution?: ProductVariantExecution): NodeGenerationContext {
    if (!execution) return context;
    const references = productMainImages(execution.parameterMetadata).map(image => ({
        id: image.id, name: image.name, storageKey: image.storageKey,
        type: image.mimeType || "image/png", dataUrl: image.url || "",
    }));
    return {
        ...context,
        prompt: `${context.prompt}\n\n【当前销售变体】\n${productParameterSupplement(execution.parameterMetadata)}`,
        referenceImages: references, imageCount: references.length,
    };
}

export function productVariantResult(metadata?: CanvasNodeMetadata) {
    return (metadata as CanvasNodeMetadata & { productVariant?: ProductVariantSnapshot } | undefined)?.productVariant;
}

export function canStartVariantGeneration(requests: ReadonlyMap<string, CanvasGenerationRequest>, nodeId: string, placement: BatchResultPlacement) {
    const prefix = `${nodeId}:variant:${placement.batchId}:`;
    const key = `${prefix}${placement.productVariant!.snapshot.id}`;
    if (requests.has(key)) return false;
    const batchControllers = new Set([...requests].filter(([id]) => id.startsWith(prefix)).map(([, request]) => request.controller));
    return ![...requests.values()].some(request => request.runningNodeId === nodeId
        && !request.controller.signal.aborted && !batchControllers.has(request.controller));
}

// 同一变体的不同提示词共用一列，各变体分列；布局和快照在提交任何请求之前确定。
export function planProductGenerationJobs(sources: CanvasNodeData[], nodes: CanvasNodeData[], connections: CanvasConnection[], batchId: string): ProductGenerationJob[] {
    const groups = new Map<string, Array<{ source: CanvasNodeData; mode: ProductGenerationJob["mode"]; prompt: string; execution?: ProductVariantExecution }>>();
    const cache = new Map<string, ProductVariantExecution[]>();
    for (const source of sources) {
        const mode = source.metadata?.generationMode || "image";
        let executions: ProductVariantExecution[] = [];
        if (mode === "image") {
            const key = generationProductParameters(source.id, nodes, connections).map(node => node.id).sort().join("|");
            if (!cache.has(key)) cache.set(key, productVariantExecutions(source.id, nodes, connections));
            executions = cache.get(key)!;
        }
        for (const execution of executions.length ? executions : [undefined]) {
            validateProductPromptInputs(source.id, nodes, connections, execution?.snapshot.id);
            const group = execution ? `${execution.snapshot.parameterId}:${execution.snapshot.id}` : "regular";
            groups.set(group, [...groups.get(group) || [], { source, mode, prompt: source.metadata?.composerContent || source.metadata?.prompt || "", execution }]);
        }
    }
    const occupied = [...nodes], jobs: ProductGenerationJob[] = [];
    for (const group of groups.values()) {
        const slots = group.map(({ source, mode }) => {
            const type = mode === "image" ? "image" : mode;
            const spec = getNodeSpec(type);
            return { source, width: spec.width, height: mode === "video" ? 420 : spec.height };
        });
        const placements = planBatchResultColumn(slots, occupied, batchId);
        group.forEach((item, index) => {
            const slot = slots[index], base = placements.get(item.source.id)!;
            const placement = { ...base, ...(item.execution ? { productVariant: item.execution } : {}) };
            jobs.push({ source: item.source, mode: item.mode, prompt: item.prompt, placement });
            // 根结果卡在一次生成多张时仍是一个批次，不额外创建产品或配置卡。
            occupied.push({ ...item.source, id: `reserved:${jobs.length}`, type: "image", width: slot.width, height: slot.height,
                position: { x: base.columnX, y: base.centerY - slot.height / 2 } });
        });
    }
    return jobs;
}

export const productGenerationImageCount = (jobs: ProductGenerationJob[], fallback: string | undefined) => jobs.reduce((total, job) =>
    total + (job.mode === "image" ? getGenerationCount(String(job.source.metadata?.count || fallback || 1)) : 0), 0);
