import type { CanvasNodeMetadata } from "@/types/canvas";
import { productMainImages, type ProductMainImage } from "./产品主图规则";
import type { ProductBriefValues, ProductParameterMetadata } from "./旧版参数规则";

export type ProductVariant = {
    id: string;
    name: string;
    enabled: boolean;
    attributes: Record<string, string>;
    imageIds: string[];
    primaryImageId?: string;
    brief?: ProductBriefValues;
    variableValues?: Record<string, string>;
};
export type ProductVariantMetadata = ProductParameterMetadata & {
    productVariants?: ProductVariant[];
    productVariantAttributes?: string[];
    productSharedImageIds?: string[];
};
export const DEFAULT_VARIANT_ATTRIBUTES = ["颜色", "尺寸", "数量", "款式"];
export const productVariants = (metadata?: CanvasNodeMetadata) => {
    const variants = (metadata as ProductVariantMetadata | undefined)?.productVariants || [];
    return variants.some(variant => variant.enabled === undefined)
        ? variants.map(variant => variant.enabled === undefined ? { ...variant, enabled: true } : variant) : variants;
};
export const variantLabel = (variant: ProductVariant) => variant.name.trim() || Object.values(variant.attributes).filter(value => value.trim()).join(" / ") || "未命名变体";

export function newProductVariant(name = "", attributes: Record<string, string> = {}, imageIds: string[] = []): ProductVariant {
    return { id: crypto.randomUUID(), name, enabled: true, attributes, imageIds, primaryImageId: imageIds[0] };
}

export function variantImages(metadata: ProductVariantMetadata, variant: ProductVariant): ProductMainImage[] {
    const images = new Map(productMainImages(metadata).map(image => [image.id, image]));
    const primary = variant.imageIds.includes(variant.primaryImageId || "") ? variant.primaryImageId : undefined;
    const ids = [...new Set([primary, ...variant.imageIds, ...metadata.productSharedImageIds || []].filter((id): id is string => Boolean(id)))];
    return ids.flatMap(id => images.has(id) ? [images.get(id)!] : []);
}

const nonempty = (values: Record<string, string | undefined> = {}) => Object.fromEntries(Object.entries(values).filter(([, value]) => value?.trim())) as Record<string, string>;
const aliases: Record<string, string[]> = {
    颜色: ["颜色", "COLOR", "COLOUR", "PRODUCT COLOR"],
    尺寸: ["尺寸", "SIZE", "PRODUCT SIZE", "DIMENSIONS"],
    数量: ["数量", "QUANTITY", "COUNT", "PACK COUNT", "SET QUANTITY"],
    款式: ["款式", "STYLE", "MODEL", "PRODUCT MODEL"],
};
const normalized = (key: string) => key.replace(/^\[|\]$/g, "").replace(/[_-]/g, " ").trim().toUpperCase();

// 每次执行固定差异与图片清单，绝不临时切换正在编辑的参数卡。
export function variantParameterMetadata(metadata: ProductVariantMetadata, variant: ProductVariant): ProductVariantMetadata {
    const attributes = nonempty(variant.attributes);
    const brief = { ...metadata.productBrief };
    if (attributes.颜色 || attributes.款式) brief.colorModel = [attributes.颜色, attributes.款式].filter(Boolean).join(" / ");
    if (attributes.尺寸) brief.dimensions = attributes.尺寸;
    if (attributes.数量) brief.packageContents = `销售数量：${attributes.数量}`;
    Object.assign(brief, nonempty(variant.brief));
    const values = { ...metadata.promptVariableValues };
    for (const [key, value] of Object.entries(attributes)) {
        const names = aliases[key] || [key];
        for (const name of names) values[`[${name}]`] = value;
        for (const token of Object.keys(values)) if (names.some(name => normalized(name) === normalized(token))) values[token] = value;
    }
    Object.assign(values, nonempty(variant.variableValues));
    const details = Object.entries(attributes).map(([key, value]) => `${key}：${value}`).join("\n");
    return {
        ...metadata, productVariants: undefined, productSharedImageIds: undefined,
        productMainImages: variantImages(metadata, variant), productBrief: brief, promptVariableValues: values,
        promptVariableSupplement: [
            metadata.promptVariableSupplement, `当前销售变体：${variantLabel(variant)}`, details,
            "本次只制作该变体。产品外观、包装清单、数量与图片文案都必须对应本变体；参考图片按本变体主图在前、共用图片在后的顺序提供。未知参数保持待确认。",
        ].filter(Boolean).join("\n"),
    };
}

// 只按明确的分隔符分组，不根据图片内容猜测颜色或规格。
export function groupVariantImagesByFilename(images: ProductMainImage[], existing: ProductVariant[]) {
    const assigned = new Set(existing.flatMap(variant => variant.imageIds));
    const groups = new Map<string, string[]>();
    for (const image of images) {
        if (assigned.has(image.id)) continue;
        const base = image.name.replace(/\.[^.]+$/, "");
        const prefix = base.split(/__|[_-](?=(?:正面|背面|侧面|细节|主图|front|back|side|\d+)(?:[_-]|$))/i)[0].trim();
        if (!prefix || prefix === base) continue;
        groups.set(prefix, [...groups.get(prefix) || [], image.id]);
    }
    const next = existing.map(variant => ({ ...variant, imageIds: [...variant.imageIds] }));
    for (const [name, imageIds] of groups) {
        const match = next.find(variant => variant.name === name);
        if (match) match.imageIds.push(...imageIds);
        else next.push(newProductVariant(name, {}, imageIds));
    }
    return next;
}
