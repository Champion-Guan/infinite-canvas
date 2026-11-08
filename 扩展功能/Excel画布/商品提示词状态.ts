import type { CanvasNodeData } from "@/types/canvas";
import { productVariants, type ProductVariantMetadata } from "./产品变体规则";
import { isPromptReady, productPlanningChangeDetails, productPromptTranslationError, promptDocument, promptPair,
    validateEnglishPrompt, type ProductPromptMetadata } from "./商品提示词规则";

export function productPromptProblems(node: CanvasNodeData, parameter?: CanvasNodeData | null, variantId?: string, cache?: Map<string, string[]>) {
    const doc = promptDocument(node);
    if (!doc) return ["提示词数据不完整，请重新使用“AI写提示词”更新原卡片。"];
    if ((node.metadata as ProductPromptMetadata).productPromptRetired) return ["本卡已不在当前策划中，请使用当前方案的提示词卡片。"];
    if (!parameter) return ["关联的产品参数卡已移除，请恢复原参数卡后再生成。"];
    const fingerprint = (node.metadata as ProductPromptMetadata).productPromptSourceFingerprint;
    const key = parameter.id + "\n" + fingerprint;
    let reasons = cache?.get(key);
    if (!reasons) {
        try { reasons = productPlanningChangeDetails(parameter.metadata as ProductVariantMetadata, fingerprint, { ignoreLanguage: true }).map(change => change.reason); }
        catch (error) { reasons = [error instanceof Error ? error.message : "商品资料不完整，请补全产品参数后再生成。"]; }
        cache?.set(key, reasons);
    }
    if (reasons.length) return reasons;
    if (doc.variantId && !productVariants(parameter.metadata).some(variant => variant.id === doc.variantId))
        return [`变体“${doc.variantName || doc.variantId}”已移除，请恢复该变体，或重新使用“AI写提示词”更新原卡片。`];
    const pair = promptPair(doc, variantId);
    if (!isPromptReady(pair)) return [pair?.translationError
        ? `英文同步失败：${productPromptTranslationError(pair.translationError)}请重试同步英文。`
        : "英文提示词尚未同步，请完成同步后再生成。"];
    try { validateEnglishPrompt(pair!.english); } catch (error) { return [error instanceof Error ? error.message : "英文提示词不完整，请重新填写。"]; }
    return [];
}

export function productPromptWarningGroups(nodes: CanvasNodeData[]) {
    const byId = new Map(nodes.map(node => [node.id, node])), cache = new Map<string, string[]>();
    const groups = new Map<string, { nodeIds: string[]; reasons: string[] }>();
    for (const node of nodes) {
        const doc = promptDocument(node);
        if (!doc || (node.metadata as ProductPromptMetadata).productPromptRetired) continue;
        const reasons = productPromptProblems(node, byId.get(doc.parameterId), undefined, cache);
        if (!reasons.length) continue;
        const key = JSON.stringify([doc.parameterId, reasons]);
        const group = groups.get(key);
        if (group) group.nodeIds.push(node.id);
        else groups.set(key, { nodeIds: [node.id], reasons });
    }
    return [...groups.values()];
}
