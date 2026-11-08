import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { productMainImages } from "./产品主图规则";
import { productVariants, variantImages, variantLabel, variantParameterMetadata, type ProductVariantMetadata } from "./产品变体规则";
import { PRODUCT_BRIEF_FIELDS, PRODUCT_PLATFORM_OPTIONS, WILDBERRIES_PLATFORM, productPlatformRules } from "./旧版参数规则";
import { readBilingualSegments, type BilingualAlignment } from "../提示词/双语片段对齐";

export const PRODUCT_PROMPT_NODE_TYPE = "guan:product-prompt";
export type BilingualPrompt = { english: string; chinese: string; translatedChinese: string; translationError?: string; alignment?: BilingualAlignment };
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
export type ProductPromptDocument = ProductImageBrief & {
    parameterId: string; generatedSignature: string; variantId?: string; variantName?: string; planName?: string;
};
export type ProductPlanningParameters = Pick<ProductVariantMetadata, "productPlatform" | "productPlatformRules" | "productBrief" |
    "promptVariableValues" | "promptVariableSupplement" | "productMainImages" | "productMainImageStorageKey" | "productMainImageUrl" |
    "productMainImageWidth" | "productMainImageHeight" | "productMainImageBytes" | "productMainImageMimeType" | "productVariants" | "productSharedImageIds">;
export const productPlanningParameterKeys = ["productPlatform", "productPlatformRules", "productBrief", "promptVariableValues",
    "promptVariableSupplement", "productMainImages", "productMainImageStorageKey", "productMainImageUrl", "productMainImageWidth",
    "productMainImageHeight", "productMainImageBytes", "productMainImageMimeType", "productVariants", "productSharedImageIds"] as const;
export const productPlanningParameters = (metadata: ProductVariantMetadata): string =>
    JSON.stringify(Object.fromEntries(productPlanningParameterKeys.map(key => [key, metadata[key]])), (key, value) =>
        key === "url" && typeof value === "string" && value.startsWith("blob:") ? undefined : value);
export type ProductPromptMetadata = CanvasNodeMetadata & {
    productImagePrompt?: ProductPromptDocument;
    productPromptConfigKey?: string;
    productPromptConfigSignature?: string;
    productPromptSourceFingerprint?: string;
    productPromptRetired?: boolean;
    productImagePlan?: Omit<ProductImagePlan, "images"> & { imageCount: number; updatedAt: string; preserved: number;
        source?: { fingerprint: string; parameters: string } };
};
export const promptDocument = (node?: CanvasNodeData | null) => (node?.metadata as ProductPromptMetadata | undefined)?.productImagePrompt;
export const promptPair = (doc: ProductPromptDocument, variantId?: string) => {
    if (doc.variantId) return !variantId || variantId === doc.variantId ? doc.variants[doc.variantId] : undefined;
    return variantId ? doc.variants[variantId] : doc.prompt;
};
export const isPromptReady = (pair?: BilingualPrompt) => Boolean(pair?.english.trim() && pair.chinese.trim()
    && pair.chinese === pair.translatedChinese && !pair.translationError);

function productPromptPurpose(brief: ProductImageBrief & { planName?: string }) {
    const name = (brief.planName || brief.name).trim();
    const purpose = /尺寸标注(?:[：:]|$)/.test(name) ? "尺寸标注" : name.split(/[：:；;\n]/)[0].trim();
    const short = Array.from(purpose);
    return short.length > 12 ? short.slice(0, 11).join("") + "…" : purpose;
}

export function productPromptTitle(brief: ProductImageBrief & { planName?: string; variantName?: string }, siblings: ProductImageBrief[] = []) {
    const purpose = productPromptPurpose(brief);
    const matching = [...new Map(siblings.filter(item => productPromptPurpose(item) === purpose).map(item => [item.key, item])).keys()];
    const label = matching.length > 1 && matching.includes(brief.key) ? `${purpose} ${matching.indexOf(brief.key) + 1}` : purpose;
    return [brief.variantName, label].filter(Boolean).join(" · ");
}

export function productPromptTranslationError(error: unknown) {
    const message = (error instanceof Error ? error.message : typeof error === "string" ? error : "").trim();
    if (/dynamically imported module|Loading chunk|ChunkLoadError|module script failed/i.test(message))
        return "翻译功能暂不可用，请刷新页面后重试。";
    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return "网络连接失败，请稍后重试。";
    if (!message || message.length > 120 || /https?:\/\/|[<>\r\n]|\/(?:Users|private|var|tmp)\//i.test(message))
        return "英文同步失败，请重试。";
    return message;
}

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
    const aligned = readBilingualSegments(value);
    const item = aligned || value as { english?: unknown; chinese?: unknown } | null;
    const chinese = text(item?.chinese, "中文对照");
    if (!/[\u3400-\u9fff]/.test(chinese)) throw Error("策划结果缺少中文对照，请重新生成。");
    return { english: validateEnglishPrompt(item?.english), chinese, translatedChinese: chinese, ...(aligned ? { alignment: aligned.alignment } : {}) };
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
    const { carouselCount: _legacyCount, generationTool: _legacyTool, imageKeywords, ...facts } = brief || {};
    const keywords = imageKeywords?.trim();
    return { ...facts, ...(keywords ? { imageKeywords: keywords } : {}) };
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
export function planningFingerprint(metadata: ProductVariantMetadata) {
    const facts = productPlanningFacts({ ...metadata, productVariants: undefined });
    const variants = productVariants(metadata).map(variant => {
        const scoped = variantParameterMetadata(metadata, variant);
        return { id: variant.id, name: variantLabel(variant), attributes: variant.attributes, brief: cleanBrief(scoped.productBrief),
            variables: scoped.promptVariableValues || {}, imageIds: variantImages(metadata, variant).map(image => image.id) };
    });
    return JSON.stringify([{ ...facts, variants }, productMainImages(metadata).map(image => [image.id, image.storageKey,
        image.storageKey ? null : image.url])]);
}

export function normalizedPlanningSnapshot(value?: string) {
    try {
        const snapshot = JSON.parse(value || "");
        if (!Array.isArray(snapshot) || snapshot.length !== 2 || !snapshot[0] || !Array.isArray(snapshot[1])) return undefined;
        // 旧方案保留稳定文件键，只忽略该文件在不同页面生成的临时地址。
        return [snapshot[0], snapshot[1].map((image: unknown) => {
            if (!Array.isArray(image) || image.length !== 3) throw Error("invalid reference");
            return [image[0], image[1], image[1] ? null : image[2]];
        })] as [Record<string, unknown>, unknown[]];
    } catch { return undefined; }
}

export type ProductPlanningChange = { label: string; reason: string };

export function productPlanningChangeDetails(metadata: ProductVariantMetadata, previous?: string, { ignoreLanguage = false } = {}): ProductPlanningChange[] {
    const current = normalizedPlanningSnapshot(planningFingerprint(metadata))!, old = normalizedPlanningSnapshot(previous);
    if (!old) return [{ label: "策划来源记录缺失", reason: "策划时的商品资料记录缺失，请重新使用“AI写提示词”更新原卡片。" }];
    const changes: ProductPlanningChange[] = [];
    const labels: Record<string, string> = { platform: "上架平台", channelRequirements: "平台规则", brief: "共用商品资料",
        variables: "Excel 变量", supplement: "提示词补充", images: "参考图", variants: "变体资料或配图" };
    const display = (value: unknown) => typeof value === "string" ? value.trim() || "未填写" : "未填写";
    const changedValue = (label: string, field: string, before: unknown, after: unknown) => {
        const original = display(before), latest = display(after);
        changes.push({ label, reason: `${field}已从“${original}”改为“${latest}”。请将${field}恢复为“${original}”，或重新使用“AI写提示词”更新原卡片。` });
    };
    for (const key of new Set([...Object.keys(current[0]), ...Object.keys(old[0])])) {
        if (ignoreLanguage && key === "language") continue;
        if (JSON.stringify(current[0][key]) === JSON.stringify(old[0][key])) continue;
        if (key === "platform") {
            const platform = (value: unknown) => PRODUCT_PLATFORM_OPTIONS.find(option => option.value === value)?.label || display(value);
            changedValue("上架平台", "上架平台", platform(old[0][key]), platform(current[0][key]));
        } else if (key === "channelRequirements" && old[0].platform !== current[0].platform) continue;
        else if (key === "brief" || key === "variables") {
            const before = old[0][key] as Record<string, unknown> || {}, after = current[0][key] as Record<string, unknown> || {};
            for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
                if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
                changedValue(labels[key], PRODUCT_BRIEF_FIELDS.find(item => item.key === field)?.label || field, before[field], after[field]);
            }
        } else if (key === "supplement") changedValue(labels[key], labels[key], old[0][key], current[0][key]);
        else if (key === "language") {
            const language = (value: unknown) => typeof value === "string" && ["俄文", "俄语", "英文", "英语", "中文"].includes(value) ? value : "未指定";
            changedValue(`语言（${language(old[0][key])} → ${language(current[0][key])}）`, "图片文字语言", language(old[0][key]), language(current[0][key]));
        } else if (key === "variants") {
            const before = old[0][key] as Array<{ id: string; name: string }> || [], after = current[0][key] as Array<{ id: string; name: string }> || [];
            const changed = [...new Set([...before, ...after].map(item => item.id))].filter(id =>
                JSON.stringify(before.find(item => item.id === id)) !== JSON.stringify(after.find(item => item.id === id)));
            const names = changed.map(id => `“${before.find(item => item.id === id)?.name || after.find(item => item.id === id)?.name || id}”`).join("、");
            changes.push({ label: labels[key], reason: `变体${names}的资料或配图与策划时不同。请恢复这些变体的原资料和配图，或重新使用“AI写提示词”更新原卡片。` });
        } else changes.push({ label: labels[key] || "商品资料", reason: `${labels[key] || "商品资料"}与策划时不同，请恢复原设置，或重新使用“AI写提示词”更新原卡片。` });
    }
    if (JSON.stringify(current[1]) !== JSON.stringify(old[1])) {
        const originals = (old[0].images as Array<{ name: string }> || []).map(image => `“${image.name}”`).join("、");
        changes.push({ label: "参考图", reason: `参考图文件已更改，策划时使用的是${originals || "原商品图片"}。请恢复原图片文件，或重新使用“AI写提示词”更新原卡片。` });
    }
    return changes;
}

export const productPlanningChanges = (metadata: ProductVariantMetadata, previous?: string, options = {}) =>
    [...new Set(productPlanningChangeDetails(metadata, previous, options).map(change => change.label))];

export const imageBriefSignature = (brief: ProductImageBrief) => JSON.stringify(brief);
export function readProductPrompt(node: CanvasNodeData, variantId?: string) {
    const doc = promptDocument(node);
    if (!doc) return undefined;
    const pair = promptPair(doc, variantId);
    if (!isPromptReady(pair)) throw Error(`“${node.title}”的英文提示词尚未同步，请完成翻译后再生成。`);
    return pair!.english;
}
