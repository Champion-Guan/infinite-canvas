import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { AiTextMessage } from "@/services/api/image";
import { useConfigStore, encodeChannelModel } from "@/stores/use-config-store";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { imageToDataUrl } from "@/services/image-storage";
import { saveProductCanvas } from "../产品/产品操作";
import { requestCanvasText } from "../画布生成/原画布文本调用";
import { productMainImages } from "./产品主图规则";
import type { ProductVariantMetadata } from "./产品变体规则";
import { PRODUCT_PLANNING_ROLE, PRODUCT_PLANNING_OUTPUT, PRODUCT_TRANSLATION_ROLE } from "./商品视觉策划指令";
import { productPlanningRequirements, validateProductPlanRequirements } from "./商品策划任务规则";
import { parseProductImagePlan, planningFingerprint, productPlanningFacts, promptDocument, promptPair,
    validateEnglishPrompt, PRODUCT_IMAGE_MODEL, type ProductPromptMetadata } from "./商品提示词规则";
import { productPlanOps } from "./商品提示词画布";

async function saved(productId: string) {
    const result = await saveProductCanvas(productId);
    if (!result.persisted) throw Error("画布保存尚未确认，请稍后重试保存。");
    return result;
}

async function request({ ctx, productId, signal, slotId, messages, assertCurrent, apply }: {
    ctx: CanvasNodeContext; productId: string; signal: AbortSignal; slotId: string; messages: AiTextMessage[];
    assertCurrent(): void; apply(text: string): void;
}) {
    const state = useConfigStore.getState(), config = buildGenerationConfig(state.config, undefined, "text");
    if (!state.isAiConfigReady(config, config.model)) {
        state.openConfigDialog(false, "channels");
        throw Error("请先配置可用的文本模型；图片策划需要支持看图的文本模型。");
    }
    const read = () => {
        signal.throwIfAborted(); assertCurrent();
        const node = ctx.getNode(ctx.node.id);
        if (!node) throw Error("卡片已移除，未写入其他画布。");
        return node;
    };
    read();
    return requestCanvasText({
        config, messages, signal, retry: true, scope: { productId, nodeId: ctx.node.id, slotId },
        previous: read().metadata?.gatewayGenerationTasks?.find(task => task.slotId === slotId),
        recordTask: async task => {
            const node = read();
            ctx.updateMetadata({ gatewayGenerationTasks: [...(node.metadata?.gatewayGenerationTasks || []).filter(item => item.slotId !== slotId), task] });
            await saved(productId);
        },
        applyAndSave: async (text, receipt) => {
            const node = read();
            if (node.metadata?.gatewayGenerationTasks?.find(task => task.slotId === slotId)?.taskId !== receipt.taskId)
                throw Error("已有更新的任务，未覆盖当前内容。");
            apply(text);
            const current = ctx.getNode(ctx.node.id)!;
            ctx.updateMetadata({ gatewayGenerationReceipts: [
                ...(current.metadata?.gatewayGenerationReceipts || []).filter(item => item.taskId !== receipt.taskId), receipt,
            ] });
            return saved(productId);
        },
    });
}

export async function planProductImages(ctx: CanvasNodeContext, productId: string, signal: AbortSignal) {
    const parameter = ctx.getNode(ctx.node.id);
    if (!parameter) throw Error("产品参数卡已移除。");
    const metadata = parameter.metadata as ProductVariantMetadata;
    const facts = productPlanningFacts(metadata), fingerprint = planningFingerprint(metadata);
    const assertCurrent = () => {
        const current = ctx.getNode(parameter.id);
        if (!current || planningFingerprint(current.metadata as ProductVariantMetadata) !== fingerprint)
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
    await request({ ctx, productId, signal, slotId: "product-image-plan", assertCurrent,
        messages: [{ role: "system", content: `${PRODUCT_PLANNING_ROLE}\n\n${PRODUCT_PLANNING_OUTPUT}` }, { role: "user", content }],
        apply: text => {
            const plan = parseProductImagePlan(text, facts.variants.map(variant => variant.id));
            validateProductPlanRequirements(plan, metadata);
            const channel = useConfigStore.getState().config.channels.find(channel =>
                channel.models.some(model => model.capability === "image" && model.name === PRODUCT_IMAGE_MODEL));
            const model = channel ? encodeChannelModel(channel.id, PRODUCT_IMAGE_MODEL) : PRODUCT_IMAGE_MODEL;
            ctx.applyOps(productPlanOps(ctx.getNode(parameter.id)!, plan, ctx.getNodes(), ctx.getConnections(), fingerprint, model));
        },
    });
}

export async function translateProductPrompt(ctx: CanvasNodeContext, productId: string, variantId: string | undefined, signal: AbortSignal) {
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
            const english = validateEnglishPrompt(text), doc = promptDocument(ctx.getNode(ctx.node.id))!;
            const pair = { ...promptPair(doc, variantId)!, english, translatedChinese: chinese, translationError: undefined };
            ctx.updateMetadata({ productImagePrompt: variantId
                ? { ...doc, variants: { ...doc.variants, [variantId]: pair } } : { ...doc, prompt: pair } } as ProductPromptMetadata);
        },
    });
}
