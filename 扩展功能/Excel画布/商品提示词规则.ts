import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { productMainImages } from "./产品主图规则";
import { productVariants, variantImages, variantLabel, variantParameterMetadata, type ProductVariantMetadata } from "./产品变体规则";
import { WILDBERRIES_PLATFORM, productPlatformRules } from "./旧版参数规则";

export const PRODUCT_PROMPT_NODE_TYPE = "guan:product-prompt";
export const PRODUCT_IMAGE_MODEL = "gpt-image-2.5-sunburst";
export type BilingualPrompt = { english: string; chinese: string; translatedChinese: string; translationError?: string };
export type ProductImageBrief = {
    key: string; kind: "main" | "carousel" | "rich"; name: string;
    buyerQuestion: string; evidence: string; composition: string; constraints: string; copyLayout: string; checks: string;
    delivery: { width: number; height: number; format: "png" | "jpeg" | "webp"; maxMB: number | null };
    prompt: BilingualPrompt; variants: Record<string, BilingualPrompt>;
};
export type ProductImagePlan = {
    overview: { buyers: string; sellingPoints: string; concerns: string; consistency: string; sequence: string };
    style: string; assumptions: string[]; pendingFacts: string[]; images: ProductImageBrief[];
};
export type ProductPromptDocument = ProductImageBrief & { parameterId: string; generatedSignature: string };
export type ProductPromptMetadata = CanvasNodeMetadata & {
    productImagePrompt?: ProductPromptDocument;
    productPromptConfigKey?: string;
    productPromptConfigSignature?: string;
    productPromptSourceFingerprint?: string;
    productPromptRetired?: boolean;
    productImagePlan?: Omit<ProductImagePlan, "images"> & { imageCount: number; updatedAt: string; preserved: number };
};
export const promptDocument = (node?: CanvasNodeData | null) => (node?.metadata as ProductPromptMetadata | undefined)?.productImagePrompt;
export const promptPair = (doc: ProductPromptDocument, variantId?: string) => variantId ? doc.variants[variantId] : doc.prompt;
export const isPromptReady = (pair?: BilingualPrompt) => Boolean(pair?.english.trim() && pair.chinese.trim()
    && pair.chinese === pair.translatedChinese && !pair.translationError);

function text(value: unknown, label: string) {
    if (typeof value !== "string" || !value.trim()) throw Error(`策划结果缺少${label}，未改动画布。`);
    return value.trim();
}
export function validateEnglishPrompt(value: unknown) {
    const result = text(value, "英文提示词");
    const latin = result.match(/[a-z]/gi)?.length || 0;
    const chinese = result.match(/[\u3400-\u9fff]/g)?.length || 0;
    if (latin < 30 || chinese > latin / 5) throw Error("英文提示词不完整或主要内容不是英文，请重新生成。");
    return result;
}
function bilingual(value: unknown): BilingualPrompt {
    const item = value as { english?: unknown; chinese?: unknown } | null;
    const chinese = text(item?.chinese, "中文对照");
    if (!/[\u3400-\u9fff]/.test(chinese)) throw Error("策划结果缺少中文对照，请重新生成。");
    return { english: validateEnglishPrompt(item?.english), chinese, translatedChinese: chinese };
}

export function parseProductImagePlan(response: string, variantIds: string[]): ProductImagePlan {
    let input;
    try { input = JSON.parse(response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
    catch { throw Error("AI 返回的策划格式不完整，请重试；原有卡片已保留。"); }
    if (!input || !Array.isArray(input.images) || !Array.isArray(input.pendingFacts) || !Array.isArray(input.assumptions)
        || (!input.images.length && !input.pendingFacts.length))
        throw Error("策划结果缺少图片方案或待确认项，原有卡片已保留。");
    const keys = new Set<string>();
    const images: ProductImageBrief[] = input.images.map((item: Record<string, unknown>) => {
        const key = text(item?.key, "图片标识");
        if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(key) || keys.has(key)) throw Error("策划中的图片标识无效或重复，请重试。");
        keys.add(key);
        if (!["main", "carousel", "rich"].includes(String(item.kind))) throw Error("策划包含不支持的图片类型。");
        const delivery = item.delivery as ProductImageBrief["delivery"] | undefined;
        if (!delivery || !Number.isSafeInteger(delivery.width) || delivery.width < 1
            || !Number.isSafeInteger(delivery.height) || delivery.height < 1
            || !["png", "jpeg", "webp"].includes(delivery.format)
            || (delivery.maxMB !== null && !(Number.isFinite(delivery.maxMB) && delivery.maxMB > 0)))
            throw Error("策划缺少有效的交付尺寸、格式或文件大小要求。");
        return {
            key, kind: item.kind as ProductImageBrief["kind"], name: text(item.name, "图片名称"),
            buyerQuestion: text(item.buyerQuestion, "买家问题"), evidence: text(item.evidence, "展示依据"),
            composition: text(item.composition, "构图与拍摄角度"), constraints: text(item.constraints, "禁止改动项"),
            copyLayout: text(item.copyLayout, "文案与排版建议（无文字时应说明）"),
            delivery, checks: text(item.checks, "人工检查项"), prompt: bilingual(item.prompt),
            variants: Object.fromEntries(variantIds.map(id => [id, bilingual((item.variants as Record<string, unknown> | undefined)?.[id])])),
        };
    });
    const overview = Object.fromEntries(["buyers", "sellingPoints", "concerns", "consistency", "sequence"]
        .map(key => [key, text(input.overview?.[key], "整套策划概览")])) as ProductImagePlan["overview"];
    return { overview, style: text(input.style, "统一视觉风格"),
        assumptions: input.assumptions.map((value: unknown) => text(value, "制作假设")),
        pendingFacts: input.pendingFacts.map((value: unknown) => text(value, "待确认内容")), images };
}

const cleanBrief = (brief?: ProductVariantMetadata["productBrief"]) => {
    const { carouselCount: _legacyCount, generationTool: _legacyTool, ...facts } = brief || {};
    return facts;
};
export function productPlanningFacts(metadata: ProductVariantMetadata) {
    const pool = productMainImages(metadata);
    if (!pool.length) throw Error("请先上传产品主图，再让 AI 策划图片。");
    if (!metadata.productBrief?.nameCategory?.trim() && !Object.values(metadata.promptVariableValues || {}).some(value => value.trim()))
        throw Error("请先填写商品名称／品类或 Excel 商品资料。");
    const variants = productVariants(metadata);
    const selected = variants.filter(item => item.enabled);
    if (variants.length && !selected.length) throw Error("请至少勾选一个需要制作的变体。");
    const names = new Set<string>(), ids = new Set<string>(), imageIds = new Set(pool.map(image => image.id));
    const variantFacts = selected.map(variant => {
        const name = variantLabel(variant);
        if (name === "未命名变体" || names.has(name) || ids.has(variant.id)) throw Error("请为选中变体填写不同的名称或属性。");
        names.add(name); ids.add(variant.id);
        if (!variant.imageIds.length || [...variant.imageIds, ...metadata.productSharedImageIds || []].some(id => !imageIds.has(id)))
            throw Error(`请为变体“${name}”分配仍可用的产品主图。`);
        const scoped = variantParameterMetadata(metadata, variant);
        return { id: variant.id, name, attributes: variant.attributes, brief: cleanBrief(scoped.productBrief),
            variables: scoped.promptVariableValues || {}, imageIds: variantImages(metadata, variant).map(image => image.id) };
    });
    const used = selected.length ? new Set(variantFacts.flatMap(variant => variant.imageIds)) : imageIds;
    const images = pool.filter(image => used.has(image.id));
    if (images.some(image => !image.storageKey && (!image.url || image.url.startsWith("blob:"))))
        throw Error("部分产品主图尚未保存，请重新上传后再策划。");
    return {
        platform: metadata.productPlatform || WILDBERRIES_PLATFORM, language: metadata.productLanguage || "",
        channelRequirements: productPlatformRules({ ...metadata, productPlatform: metadata.productPlatform || WILDBERRIES_PLATFORM }),
        brief: cleanBrief(metadata.productBrief), variables: metadata.promptVariableValues || {},
        supplement: metadata.promptVariableSupplement || "",
        images: images.map(image => ({ id: image.id, name: image.name })), variants: variantFacts,
    };
}
export const planningFingerprint = (metadata: ProductVariantMetadata) => JSON.stringify([
    productPlanningFacts(metadata), productMainImages(metadata).map(image => [image.id, image.storageKey, image.url]),
]);
export const imageBriefSignature = (brief: ProductImageBrief) => JSON.stringify(brief);
export function readProductPrompt(node: CanvasNodeData, variantId?: string) {
    const doc = promptDocument(node);
    if (!doc) return undefined;
    const pair = promptPair(doc, variantId);
    if (!isPromptReady(pair)) throw Error(`“${node.title}”的英文提示词尚未同步，请完成翻译后再生成。`);
    return pair!.english;
}
