import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { AiTextMessage } from "@/services/api/image";
import { useConfigStore } from "@/stores/use-config-store";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { imageToDataUrl } from "@/services/image-storage";
import { saveProductCanvas } from "../产品/产品操作";
import { requestCanvasText } from "../画布生成/原画布文本调用";
import { productMainImages } from "./产品主图规则";
import type { ProductVariantMetadata } from "./产品变体规则";
import { PRODUCT_PLANNING_OUTPUT, PRODUCT_TRANSLATION_ROLE } from "./商品视觉策划指令";
import { imagePlanningSystemPrompt } from "../系统提示词/分类提示词规则";
import { productPlanningRequirements, validateProductPlanRequirements } from "./商品策划任务规则";
import { parseProductImagePlan, planningFingerprint, productPlanningChanges, productPlanningFacts, promptDocument, promptPair,
    validateEnglishPrompt, type ProductPromptMetadata } from "./商品提示词规则";
import { productPlanOps } from "./商品提示词画布";
import { requireModelConfigured } from "../产品配置/模型配置门禁";
import { notifyProductPlanning } from "./商品策划完成通知";
import { readBilingualSegments } from "../提示词/双语片段对齐";
import { productCanvasResidency } from "../产品/画布驻留保护";
import type { TextTaskPhase } from "../主题/任务阶段反馈";

async function saved(productId: string) {
    const result = await saveProductCanvas(productId);
    if (!result.persisted) throw Error("画布保存尚未确认，请稍后重试保存。");
    return result;
}

async function request({ ctx, productId, signal, slotId, messages, assertCurrent, apply, onPhase }: {
    ctx: CanvasNodeContext; productId: string; signal: AbortSignal; slotId: string; messages: AiTextMessage[];
    assertCurrent(): void; apply(text: string): void; onPhase?(phase: TextTaskPhase): void;
}) {
    const state = useConfigStore.getState(), config = {
        ...buildGenerationConfig(state.config, undefined, "text"), systemPrompt: "", textSystemPrompt: "",
    };
    requireModelConfigured(config, "text");
    const read = () => {
        signal.throwIfAborted(); assertCurrent();
        const node = ctx.getNode(ctx.node.id);
        if (!node) throw Error("卡片已移除，未写入其他画布。");
        return node;
    };
    read();
    onPhase?.("requesting");
    return requestCanvasText({
        config, messages, signal, retry: true, scope: { productId, nodeId: ctx.node.id, slotId },
        previous: read().metadata?.gatewayGenerationTasks?.find(task => task.slotId === slotId),
        recordTask: async task => {
            const node = read();
            onPhase?.("saving-task");
            ctx.updateMetadata({ gatewayGenerationTasks: [...(node.metadata?.gatewayGenerationTasks || []).filter(item => item.slotId !== slotId), task] });
            await saved(productId);
            if (!signal.aborted) onPhase?.("requesting");
        },
        applyAndSave: async (text, receipt) => {
            const node = read();
            if (node.metadata?.gatewayGenerationTasks?.find(task => task.slotId === slotId)?.taskId !== receipt.taskId)
                throw Error("已有更新的任务，未覆盖当前内容。");
            onPhase?.("validating");
            apply(text);
            const current = ctx.getNode(ctx.node.id)!;
            ctx.updateMetadata({ gatewayGenerationReceipts: [
                ...(current.metadata?.gatewayGenerationReceipts || []).filter(item => item.taskId !== receipt.taskId), receipt,
            ] });
            onPhase?.("saving-result");
            return saved(productId);
        },
    });
}

export async function planProductImages(ctx: CanvasNodeContext, productId: string, signal: AbortSignal, onPhase?: (phase: TextTaskPhase) => void) {
    const release = productCanvasResidency.acquire(productId);
    try {
    signal.throwIfAborted();
    onPhase?.("preparing");
    notifyProductPlanning(productId, ctx.node.id, false);
    requireModelConfigured(buildGenerationConfig(useConfigStore.getState().config, undefined, "text"), "text");
    const planningRole = imagePlanningSystemPrompt(useConfigStore.getState().config);
    const parameter = ctx.getNode(ctx.node.id);
    if (!parameter) throw Error("产品参数卡已移除。");
    const metadata = parameter.metadata as ProductVariantMetadata;
    const facts = productPlanningFacts(metadata), fingerprint = planningFingerprint(metadata);
    const assertCurrent = () => {
        const current = ctx.getNode(parameter.id);
        if (!current || productPlanningChanges(current.metadata as ProductVariantMetadata, fingerprint, { ignoreLanguage: true }).length)
            throw Error("商品资料或参考图已更改，请用最新资料重新策划；原有卡片已保留。");
    };
    const content: Exclude<AiTextMessage["content"], string> = [{ type: "text", text: JSON.stringify({
        facts, requirements: productPlanningRequirements(metadata),
        previousImages: ctx.getNodes().flatMap(node => {
            const doc = promptDocument(node);
            return doc?.parameterId === parameter.id && !(node.metadata as ProductPromptMetadata).productPromptRetired
                ? [{ key: doc.key, kind: doc.kind, name: doc.name }] : [];
        }),
    }) }];
    const usedIds = new Set(facts.images.map(image => image.id));
    for (const image of productMainImages(metadata).filter(image => usedIds.has(image.id))) {
        signal.throwIfAborted(); assertCurrent();
        const url = await imageToDataUrl({ storageKey: image.storageKey, url: image.url }, { signal });
        if (!url) throw Error(`无法读取“${image.name}”，未提交策划。`);
        content.push({ type: "text", text: `Reference ID: ${image.id}; filename: ${image.name}` },
            { type: "image_url", image_url: { url } });
    }
    let hasImages = false;
    await request({ ctx, productId, signal, slotId: "product-image-plan", assertCurrent, onPhase,
        messages: [{ role: "system", content: `${planningRole}\n\n${PRODUCT_PLANNING_OUTPUT}` }, { role: "user", content }],
        apply: text => {
            const plan = parseProductImagePlan(text, facts.variants.map(variant => variant.id));
            validateProductPlanRequirements(plan, metadata);
            const config = useConfigStore.getState().config;
            const model = config.imageModel || config.model;
            ctx.applyOps(productPlanOps(ctx.getNode(parameter.id)!, plan, ctx.getNodes(), ctx.getConnections(), fingerprint, model));
            hasImages = plan.images.length > 0;
        },
    });
    signal.throwIfAborted(); assertCurrent();
    if (hasImages) { notifyProductPlanning(productId, parameter.id, true); onPhase?.("ready"); }
    else onPhase?.("needs-input");
    } finally { release(); }
}

export async function translateProductPrompt(ctx: CanvasNodeContext, productId: string, variantId: string | undefined, signal: AbortSignal) {
    const release = productCanvasResidency.acquire(productId);
    try {
    signal.throwIfAborted();
    requireModelConfigured(buildGenerationConfig(useConfigStore.getState().config, undefined, "text"), "text");
    const source = promptDocument(ctx.getNode(ctx.node.id));
    const chinese = source && promptPair(source, variantId)?.chinese;
    if (!chinese?.trim()) throw Error("请先填写中文提示词。");
    const assertCurrent = () => {
        const doc = promptDocument(ctx.getNode(ctx.node.id));
        if (!doc || promptPair(doc, variantId)?.chinese !== chinese) throw Error("中文已更改，旧翻译已丢弃。");
    };
    await request({ ctx, productId, signal, slotId: `product-prompt-translation:${variantId || "base"}`, assertCurrent,
        messages: [{ role: "system", content: PRODUCT_TRANSLATION_ROLE }, { role: "user", content: chinese }],
        apply: text => {
            const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
            const aligned = raw.startsWith("{") ? readBilingualSegments(JSON.parse(raw)) : undefined;
            if (raw.startsWith("{") && !aligned) throw Error("翻译缺少双语对应片段，请重试。");
            if (aligned && aligned.chinese !== chinese.trim()) throw Error("翻译对应的中文与原文不一致，请重试。");
            const english = validateEnglishPrompt(aligned?.english || raw), doc = promptDocument(ctx.getNode(ctx.node.id))!;
            const leading = chinese.length - chinese.trimStart().length;
            const pair = { ...promptPair(doc, variantId)!, english, translatedChinese: chinese,
                alignment: aligned?.alignment?.map(([a, b, c, d]) => [a + leading, b + leading, c, d] as [number, number, number, number]),
                translationError: undefined };
            ctx.updateMetadata({ productImagePrompt: variantId
                ? { ...doc, variants: { ...doc.variants, [variantId]: pair } } : { ...doc, prompt: pair } } as ProductPromptMetadata);
        },
    });
    } finally { release(); }
}
