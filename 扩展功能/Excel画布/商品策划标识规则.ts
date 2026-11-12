type ImageKeyIssue = { path: string; problem: "invalid_image_key" | "ambiguous_image_reference" };
export class ProductPlanImageKeyError extends Error {
    readonly code = "invalid_product_plan_keys";
    constructor(readonly issues: ImageKeyIssue[]) {
        super("图片编号或关联信息需要修正，原方案已保留。");
        this.name = "ProductPlanImageKeyError";
    }
}
export const validProductImageKey = (value: unknown): value is string =>
    typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);

export function productImageKeyCounts(keys: unknown[]) {
    const counts = new Map<string, number>();
    for (const value of keys) if (typeof value === "string") {
        const key = value.trim();
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

// 仅改内部编号及其明确引用；重复编号被资料引用时不能猜测关联到哪张图。
export function normalizeProductPlanImageKeys(input: { images: unknown[]; confirmations?: unknown }) {
    const images = input.images as Array<{ key: unknown }>;
    const keys = images.map(image => typeof image?.key === "string" ? image.key.trim() : undefined);
    const counts = productImageKeyCounts(keys);
    const issues: ImageKeyIssue[] = [];
    for (const [index, key] of keys.entries())
        if (!key || key.length > 240) issues.push({ path: `images[${index}].key`, problem: "invalid_image_key" });
    const fields = Array.isArray(input.confirmations) ? input.confirmations : [];
    for (const [index, field] of fields.entries()) if (Array.isArray(field?.imageKeys))
        for (const [referenceIndex, key] of field.imageKeys.entries())
            if (typeof key === "string" && (counts.get(key.trim()) || 0) > 1)
                issues.push({ path: `confirmations[${index}].imageKeys[${referenceIndex}]`, problem: "ambiguous_image_reference" });
    if (issues.length) throw new ProductPlanImageKeyError(issues.slice(0, 32));

    const reserved = new Set(keys.filter(validProductImageKey)), used = new Set<string>(), replacements = new Map<string, string>();
    const normalized = keys.map((original, index) => {
        const raw = original!;
        if (validProductImageKey(raw) && !used.has(raw)) {
            used.add(raw);
            if (counts.get(raw) === 1) replacements.set(raw, raw);
            return raw;
        }
        const base = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "")
            || `image-${index + 1}`;
        let key = base, suffix = 1;
        while (used.has(key) || reserved.has(key)) {
            const ending = `-${++suffix}`;
            key = base.slice(0, 80 - ending.length).replace(/-+$/, "") + ending;
        }
        used.add(key);
        if (counts.get(raw) === 1) replacements.set(raw, key);
        return key;
    });
    for (const [index, image] of images.entries()) image.key = normalized[index];
    for (const field of fields) if (Array.isArray(field?.imageKeys))
        field.imageKeys = field.imageKeys.map((key: unknown) => typeof key === "string" ? replacements.get(key.trim()) ?? key : key);
}
