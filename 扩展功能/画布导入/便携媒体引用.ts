const mediaKey = (value: unknown): value is string => typeof value === "string" && /^(image|video|audio|file):/.test(value);
const storageField = (field: string) => /storageKey$/i.test(field) || field === "references";
const urlFields = new Set(["url", "src", "previewUrl", "dataUrl", "content", "productMainImageUrl"]);

function mainImageAlias(record: Record<string, unknown>) {
    if (!Array.isArray(record.productMainImages) || typeof record.productMainImageUrl !== "string" || !record.productMainImageUrl) return undefined;
    const image = record.productMainImages.find(item => item && item.url === record.productMainImageUrl && mediaKey(item.storageKey));
    return image?.storageKey as string | undefined;
}

function planningSnapshot(value: unknown, field: string) {
    if (typeof value !== "string" || !["productPromptSourceFingerprint", "fingerprint", "parameters"].includes(field)) return null;
    try {
        const parsed = JSON.parse(value);
        if (["productPromptSourceFingerprint", "fingerprint"].includes(field) && Array.isArray(parsed) && parsed.length === 2
            && Array.isArray(parsed[1]) && parsed[1].every((entry: unknown) => Array.isArray(entry) && entry.length === 3))
            return { kind: "fingerprint" as const, value: parsed };
        if (field === "parameters" && parsed && !Array.isArray(parsed) && typeof parsed === "object"
            && ("productMainImages" in parsed || "productMainImageStorageKey" in parsed))
            return { kind: "parameters" as const, value: parsed };
    } catch { /* 普通文案和已有无效来源记录不当成媒体快照重写。 */ }
    return null;
}

export function collectCanvasStorageKeys(value: unknown, keys = new Set<string>(), field = ""): string[] {
    const snapshot = planningSnapshot(value, field);
    if (snapshot?.kind === "parameters") collectCanvasStorageKeys(snapshot.value, keys);
    // 指纹仅用于比较；旧指纹可能有意记录已被替换的文件，不要求重新导出它。
    if (typeof value === "string" && storageField(field) && mediaKey(value)) keys.add(value);
    else if (Array.isArray(value)) value.forEach(entry => collectCanvasStorageKeys(entry, keys, field));
    else if (value && typeof value === "object")
        Object.entries(value).forEach(([name, entry]) => collectCanvasStorageKeys(
            name === "productMainImageStorageKey" ? mainImageAlias(value as Record<string, unknown>) || entry : entry, keys, name));
    return [...keys];
}

function urlStorageKey(parent: Record<string, unknown> | undefined, field: string) {
    if (!parent) return undefined;
    const key = field === "productMainImageUrl" ? parent.productMainImageStorageKey
        : parent.storageKey || parent.deliveryStorageKey || parent.originalStorageKey;
    return mediaKey(key) ? key : undefined;
}

/** ZIP仅携带稳定文件键；显示地址由接收端按需恢复，不读取来源浏览器的Blob。 */
export function remapCanvasMedia<T>(value: T, keys: ReadonlyMap<string, string>, missingMedia: ReadonlyMap<string, string> = new Map()): T {
    const aliases = new Map<string, string>();
    const legacyKeys = new Map<string, string>();
    const collectAliases = (item: unknown, field = "") => {
        const snapshot = planningSnapshot(item, field);
        if (snapshot?.kind === "parameters") collectAliases(snapshot.value);
        if (Array.isArray(item)) item.forEach(entry => collectAliases(entry, field));
        else if (item && typeof item === "object") {
            const record = item as Record<string, unknown>, mainKey = mainImageAlias(record);
            if (mainKey && mediaKey(record.productMainImageStorageKey)) legacyKeys.set(record.productMainImageStorageKey, mainKey);
            for (const [name, entry] of Object.entries(item)) {
                if (urlFields.has(name) && typeof entry === "string" && entry.startsWith("blob:")) {
                    const key = name === "productMainImageUrl" ? mainKey || urlStorageKey(record, name) : urlStorageKey(record, name);
                    if (key && keys.has(key)) aliases.set(entry, key);
                }
                collectAliases(entry, name);
            }
        }
    };
    collectAliases(value);
    const remapKey = (key: string) => {
        const mapped = keys.get(key) || keys.get(legacyKeys.get(key) || "") || missingMedia.get(key);
        if (!mapped) throw new Error("画布引用的媒体未包含在 ZIP 中");
        return mapped;
    };
    const remap = (item: unknown, field = "", parent?: Record<string, unknown>): unknown => {
        const snapshot = planningSnapshot(item, field);
        if (snapshot?.kind === "parameters") return JSON.stringify(remap(snapshot.value));
        if (snapshot?.kind === "fingerprint") return JSON.stringify([
            snapshot.value[0],
            snapshot.value[1].map(([id, key, url]: unknown[]) => [id,
                typeof key === "string" ? keys.get(key) || keys.get(legacyKeys.get(key) || "") || key : key, key ? null : url]),
        ]);
        if (typeof item === "string") {
            if (storageField(field) && mediaKey(item)) return remapKey(item);
            if (item.startsWith("blob:")) {
                const direct = urlStorageKey(parent, field);
                const key = direct && (keys.has(direct) || legacyKeys.has(direct) || missingMedia.has(direct)) ? direct : aliases.get(item);
                if (!key) throw new Error("画布包含未打包的临时媒体，请在原电脑重新导出");
                const mapped = remapKey(key);
                return field === "references" ? mapped : "";
            }
            return item;
        }
        if (Array.isArray(item)) return item.map(entry => remap(entry, field));
        if (item && typeof item === "object") return Object.fromEntries(Object.entries(item)
            .map(([name, entry]) => [name, remap(entry, name, item as Record<string, unknown>)]));
        return item;
    };
    return remap(value) as T;
}
