import { newProductVariant, variantLabel, type ProductVariant, type ProductVariantMetadata } from "./产品变体规则";
import { productMainImages } from "./产品主图规则";

export type VariantManagerDraft = {
    variants: ProductVariant[];
    attributes: string[];
    sharedImageIds: string[];
    addedByImage: Record<string, string>;
};
const fields = (metadata: ProductVariantMetadata) => JSON.stringify([
    metadata.productVariants || [], metadata.productVariantAttributes, metadata.productSharedImageIds || [],
]);
export const variantManagerRevision = fields;
export function createVariantManagerDraft(metadata: ProductVariantMetadata, attributes: string[]): VariantManagerDraft {
    return { variants: structuredClone(metadata.productVariants || []), attributes: [...attributes],
        sharedImageIds: [...metadata.productSharedImageIds || []], addedByImage: {} };
}
export function variantImageOwner(draft: VariantManagerDraft, imageId: string) {
    return draft.variants.find(variant => variant.imageIds.includes(imageId));
}
function availableImageIds(draft: VariantManagerDraft, ids: string[], metadata: ProductVariantMetadata) {
    const available = new Set(productMainImages(metadata).map(image => image.id));
    return [...new Set(ids)].filter(id => available.has(id) && !draft.sharedImageIds.includes(id) && !variantImageOwner(draft, id));
}
function availableName(draft: VariantManagerDraft, name: string) {
    const base = name.replace(/\.[^.]+$/, "").trim() || "变体";
    const used = new Set(draft.variants.map(variantLabel));
    if (!used.has(base)) return base;
    let index = 2;
    while (used.has(`${base} ${index}`)) index++;
    return `${base} ${index}`;
}
export function addVariantGroup(draft: VariantManagerDraft, ids: string[], metadata: ProductVariantMetadata, single = false): VariantManagerDraft {
    const imageIds = availableImageIds(draft, ids, metadata);
    if (!imageIds.length) return draft;
    const first = productMainImages(metadata).find(image => image.id === imageIds[0])!;
    const variant = newProductVariant(availableName(draft, first.name), {}, imageIds);
    return { ...draft, variants: [...draft.variants, variant],
        addedByImage: single ? { ...draft.addedByImage, [first.id]: variant.id } : draft.addedByImage };
}
export function toggleSingleVariantImage(draft: VariantManagerDraft, imageId: string, metadata: ProductVariantMetadata): VariantManagerDraft {
    const createdId = draft.addedByImage[imageId];
    if (!createdId) return addVariantGroup(draft, [imageId], metadata, true);
    const addedByImage = { ...draft.addedByImage };
    delete addedByImage[imageId];
    return { ...draft, variants: draft.variants.filter(variant => variant.id !== createdId), addedByImage };
}
export function removeDraftVariant(draft: VariantManagerDraft, variantId: string): VariantManagerDraft {
    return { ...draft, variants: draft.variants.filter(variant => variant.id !== variantId),
        addedByImage: Object.fromEntries(Object.entries(draft.addedByImage).filter(([, id]) => id !== variantId)) };
}
export function variantManagerPatch(draft: VariantManagerDraft, current: ProductVariantMetadata, revision: string) {
    if (variantManagerRevision(current) !== revision) throw Error("变体已在其他位置修改，请关闭面板后重新打开，原修改未覆盖。");
    const currentImages = new Set(productMainImages(current).map(image => image.id));
    const originals = new Map((current.productVariants || []).map(variant => [variant.id, variant]));
    const names = new Map<string, number>();
    for (const variant of draft.variants) names.set(variantLabel(variant), (names.get(variantLabel(variant)) || 0) + 1);
    for (const variant of draft.variants) {
        const name = variantLabel(variant);
        const unchanged = JSON.stringify(variant) === JSON.stringify(originals.get(variant.id));
        if (!unchanged && (name === "未命名变体" || names.get(name)! > 1)) throw Error("请为编辑的变体填写不同的名称或属性。");
        if (!unchanged && variant.imageIds.some(id => !currentImages.has(id))) throw Error(`“${name}”的图片已被移除，请重新核对配图。`);
    }
    return { productVariants: draft.variants, productVariantAttributes: draft.attributes,
        productSharedImageIds: draft.sharedImageIds } as ProductVariantMetadata;
}
