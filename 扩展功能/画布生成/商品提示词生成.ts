import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { buildNodeGenerationContext, buildNodeGenerationInputs, type NodeGenerationInput, type NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { productMainImages } from "../Excel画布/产品主图规则";
import { productPromptInputs, validateProductPromptInputs } from "../Excel画布/商品提示词输入";
import { promptDocument, promptPair, type ProductPromptMetadata } from "../Excel画布/商品提示词规则";
import type { ProductVariantMetadata } from "../Excel画布/产品变体规则";
import { productVariantExecutions, variantGenerationContext, variantInputPrompt, variantScopedNodes, type ProductVariantExecution } from "./产品变体生成";
import { productImageLanguageRequirement } from "../Excel画布/商品图片语言";
import { compileConfirmationPair, confirmationImageReferences } from "../Excel画布/商品待确认提示词";
import type { GenerationInputCounts, GenerationInputSummary } from "./生成输入规则";

export function productPromptInputSummary(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[],
    fallback: GenerationInputCounts): GenerationInputSummary {
    const node = nodes.find(item => item.id === nodeId);
    if (!node) return fallback;
    const prompt = node.metadata?.composerContent?.trim() || node.metadata?.prompt || "";
    try {
        const executions = (node.metadata?.generationMode || "image") === "image" ? productVariantExecutions(nodeId, nodes, connections) : [];
        const read = (execution?: ProductVariantExecution) => {
            const scoped = variantScopedNodes(nodes, execution), prompts = productPromptInputs(nodeId, scoped, connections);
            if (new Set(prompts.map(source => promptDocument(source)!.parameterId)).size > 1)
                throw Error("一个生成配置只能使用一个产品的提示词，请分开不同产品的连线。");
            if (!prompts.length) return variantGenerationContext(buildNodeGenerationContext(nodeId, scoped, connections,
                variantInputPrompt(prompt, execution)), execution);
            const { resources } = productInputResources(nodeId, scoped, connections, prompt);
            const parameter = scoped.find(item => item.id === promptDocument(prompts[0])!.parameterId);
            if (!parameter) throw Error("关联的产品参数卡已移除，请恢复后核对输入。");
            return {
                referenceImages: productReferenceImages(parameter, prompts, resources, execution),
                textCount: resources.filter(input => input.type === "text").length,
                videoCount: resources.filter(input => input.video).length,
                audioCount: resources.filter(input => input.audio).length,
            };
        };
        if (executions.length) {
            const variants = executions.map(execution => {
                const input = read(execution);
                return { id: execution.snapshot.id, name: execution.snapshot.name, textCount: input.textCount,
                    imageCount: input.referenceImages.length, videoCount: input.videoCount, audioCount: input.audioCount,
                    images: input.referenceImages.map(image => image.name) };
            });
            return { textCount: Math.max(...variants.map(item => item.textCount)),
                imageCount: Math.max(...variants.map(item => item.imageCount)),
                videoCount: Math.max(...variants.map(item => item.videoCount)),
                audioCount: Math.max(...variants.map(item => item.audioCount)), variants };
        }
        const input = read();
        return { textCount: input.textCount, imageCount: input.referenceImages.length, videoCount: input.videoCount, audioCount: input.audioCount };
    } catch (error) {
        return { textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0,
            error: error instanceof Error ? error.message : "生成输入尚未就绪，请核对关联卡片。" };
    }
}

function productInputResources(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string) {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    const composer = nodes.find(node => node.id === nodeId)?.metadata?.composerContent?.trim();
    const flatten = (items: NodeGenerationInput[]) => items.flatMap(item => item.type === "group" ? item.children : [item]);
    const selected = composer ? inputs.filter(input => [...prompt.matchAll(/@\[node:([^\]]+)\]/g)].some(match => match[1] === input.nodeId)) : inputs;
    const resources = [...new Map(flatten(selected).map(input => [input.nodeId, input])).values()];
    return { inputs, composer, resources, flatten };
}
function productReferenceImages(parameter: CanvasNodeData, prompts: CanvasNodeData[],
    resources: ReturnType<typeof productInputResources>["resources"], execution?: ProductVariantExecution) {
    const pendingPhotos = prompts.flatMap(input => {
        const doc = promptDocument(input)!;
        return confirmationImageReferences(parameter.metadata || {}, doc, execution?.snapshot.id || doc.variantId);
    });
    const photos = [...new Map([...productMainImages(parameter.metadata as ProductVariantMetadata), ...pendingPhotos].map(image => [image.id, image])).values()].map(image => ({
        id: image.id, name: image.name, storageKey: image.storageKey, dataUrl: image.url || "", type: image.mimeType || "image/png",
    }));
    // 变体只使用其独有照片和共用照片，不混入其他销售款；提示词保持完整英文。
    return execution ? photos : [...new Map([...photos, ...resources.flatMap(input => input.image ? [input.image] : [])]
        .map(image => [image.id, image])).values()];
}
export function buildProductGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[],
    prompt: string, execution?: ProductVariantExecution): NodeGenerationContext {
    const prompts = validateProductPromptInputs(nodeId, nodes, connections, execution?.snapshot.id);
    if (!prompts.length) return variantGenerationContext(buildNodeGenerationContext(nodeId,
        variantScopedNodes(nodes, execution), connections, variantInputPrompt(prompt, execution)), execution);
    const scoped = variantScopedNodes(nodes, execution).map(node => {
        const doc = promptDocument(node);
        if (!doc || !prompts.some(input => input.id === node.id)) return node;
        const parameter = nodes.find(item => item.id === doc.parameterId);
        const selected = execution?.snapshot.id || doc.variantId;
        const pair = compileConfirmationPair(promptPair(doc, selected)!, parameter?.metadata, doc.key, selected).pair;
        return { ...node, metadata: { ...node.metadata, productImagePrompt: { ...doc, prompt: pair,
            ...(selected ? { variants: { ...doc.variants, [selected]: pair } } : {}) } } as ProductPromptMetadata };
    });
    const { inputs, composer, resources, flatten } = productInputResources(nodeId, scoped, connections, prompt);
    const byId = new Map(inputs.map(input => [input.nodeId, input]));
    const expanded = composer ? prompt.replace(/@\[node:([^\]]+)\]/g, (_, id: string) => {
        const input = byId.get(id);
        return input ? flatten([input]).map(item => item.text || item.title).join("\n\n") : "";
    }) : [prompt, ...resources.flatMap(input => input.text ? [input.text] : [])].filter(Boolean).join("\n\n");
    const parameter = scoped.find(node => node.id === promptDocument(prompts[0])!.parameterId)!;
    const referenceImages = productReferenceImages(parameter, prompts, resources, execution);
    const referenceVideos = resources.flatMap(input => input.video ? [input.video] : []);
    const referenceAudios = resources.flatMap(input => input.audio ? [input.audio] : []);
    const references = referenceImages.map((image, index) => `Image ${index + 1}: reference ID "${image.id}", filename "${image.name}".`).join("\n");
    const language = productImageLanguageRequirement((parameter.metadata as ProductVariantMetadata).productLanguage);
    return { prompt: [expanded, references && `Attached product references in order:\n${references}`, language].filter(Boolean).join("\n\n"), referenceImages, referenceVideos, referenceAudios,
        textCount: resources.filter(input => input.type === "text").length, imageCount: referenceImages.length,
        videoCount: referenceVideos.length, audioCount: referenceAudios.length };
}
