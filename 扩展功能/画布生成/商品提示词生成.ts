import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { buildNodeGenerationContext, buildNodeGenerationInputs, type NodeGenerationInput, type NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { productMainImages } from "../Excel画布/产品主图规则";
import { productPromptInputs, validateProductPromptInputs } from "../Excel画布/商品提示词输入";
import { promptDocument, promptPair, type ProductPromptMetadata } from "../Excel画布/商品提示词规则";
import type { ProductVariantMetadata } from "../Excel画布/产品变体规则";
import { generationProductParameters, variantGenerationContext, variantInputPrompt, variantScopedNodes, type ProductVariantExecution } from "./产品变体生成";
import { productVariants, variantImages } from "../Excel画布/产品变体规则";
import { productImageLanguageRequirement } from "../Excel画布/商品图片语言";

export function productPromptInputSummary(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[],
    fallback: { textCount: number; imageCount: number; videoCount: number; audioCount: number }) {
    const prompts = productPromptInputs(nodeId, nodes, connections);
    if (!prompts.length) return fallback;
    const ids = new Set<string>();
    const parameters = generationProductParameters(nodeId, nodes, connections);
    for (const source of prompts) {
        const doc = promptDocument(source)!;
        const parameter = parameters.find(item => item.id === doc.parameterId);
        if (!parameter) continue;
        const metadata = parameter.metadata as ProductVariantMetadata;
        const variant = productVariants(metadata).find(item => item.id === doc.variantId);
        const photos = variant ? variantImages(metadata, variant) : productMainImages(metadata);
        for (const image of photos) ids.add(image.id);
    }
    return { ...fallback, imageCount: Math.max(ids.size, fallback.imageCount) };
}

export function buildProductGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[],
    prompt: string, execution?: ProductVariantExecution): NodeGenerationContext {
    const prompts = validateProductPromptInputs(nodeId, nodes, connections, execution?.snapshot.id);
    if (!prompts.length) return variantGenerationContext(buildNodeGenerationContext(nodeId,
        variantScopedNodes(nodes, execution), connections, variantInputPrompt(prompt, execution)), execution);
    const scoped = variantScopedNodes(nodes, execution).map(node => {
        const doc = promptDocument(node);
        return doc && prompts.some(input => input.id === node.id) ? { ...node, metadata: {
            ...node.metadata, productImagePrompt: { ...doc, prompt: promptPair(doc, execution?.snapshot.id)! },
        } as ProductPromptMetadata } : node;
    });
    const inputs = buildNodeGenerationInputs(nodeId, scoped, connections);
    const composer = nodes.find(node => node.id === nodeId)?.metadata?.composerContent?.trim();
    const flatten = (items: NodeGenerationInput[]) => items.flatMap(item => item.type === "group" ? item.children : [item]);
    const selected = composer ? inputs.filter(input => [...prompt.matchAll(/@\[node:([^\]]+)\]/g)].some(match => match[1] === input.nodeId)) : inputs;
    const resources = [...new Map(flatten(selected).map(input => [input.nodeId, input])).values()];
    const byId = new Map(inputs.map(input => [input.nodeId, input]));
    const expanded = composer ? prompt.replace(/@\[node:([^\]]+)\]/g, (_, id: string) => {
        const input = byId.get(id);
        return input ? flatten([input]).map(item => item.text || item.title).join("\n\n") : "";
    }) : [prompt, ...resources.flatMap(input => input.text ? [input.text] : [])].filter(Boolean).join("\n\n");
    const parameter = scoped.find(node => node.id === promptDocument(prompts[0])!.parameterId)!;
    const photos = productMainImages(parameter.metadata as ProductVariantMetadata).map(image => ({
        id: image.id, name: image.name, storageKey: image.storageKey, dataUrl: image.url || "", type: image.mimeType || "image/png",
    }));
    // 变体只使用其独有照片和共用照片，不混入其他销售款；提示词保持完整英文。
    const referenceImages = execution ? photos : [...new Map([...photos, ...resources.flatMap(input => input.image ? [input.image] : [])]
        .map(image => [image.id, image])).values()];
    const referenceVideos = resources.flatMap(input => input.video ? [input.video] : []);
    const referenceAudios = resources.flatMap(input => input.audio ? [input.audio] : []);
    const references = referenceImages.map((image, index) => `Image ${index + 1}: reference ID "${image.id}", filename "${image.name}".`).join("\n");
    const language = productImageLanguageRequirement((parameter.metadata as ProductVariantMetadata).productLanguage);
    return { prompt: [expanded, references && `Attached product references in order:\n${references}`, language].filter(Boolean).join("\n\n"), referenceImages, referenceVideos, referenceAudios,
        textCount: resources.filter(input => input.type === "text").length, imageCount: referenceImages.length,
        videoCount: referenceVideos.length, audioCount: referenceAudios.length };
}
