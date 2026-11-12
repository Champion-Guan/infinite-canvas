import { productMainImages, type ProductMainImage } from "./产品主图规则";
import type { ConfirmationMetadata } from "./商品待确认规则";
import type { ProductImageMetadata } from "./产品主图规则";

export type ImageReferenceLabel = ProductMainImage & { number: number; label: string };
export function imageReferenceName(name: string) {
    const value = name.replace(/\.[a-z0-9]{1,8}$/i, "").replace(/[【】\r\n]/g, " ").trim();
    return !value || /^[a-f0-9-]{24,}$/i.test(value) ? "图片" : value;
}
export function imageReferenceCatalog(metadata?: ProductImageMetadata & ConfirmationMetadata): ImageReferenceLabel[] {
    const images = [...productMainImages(metadata), ...(metadata?.productConfirmations || []).flatMap(answer => answer.images || [])];
    return [...new Map(images.map(image => [image.id, image])).values()].map((image, index) => ({
        ...image, number: index + 1, label: `【\u2003图 ${index + 1} · ${imageReferenceName(image.name)}】`,
    }));
}
export type ImageReferenceOccurrence = { start: number; end: number; rawStart: number; rawEnd: number; rawText: string; id: string; label: string; image?: ImageReferenceLabel };
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function projectImageReferences(raw: string, images: ImageReferenceLabel[]) {
    const known = new Map(images.map(image => [image.id, image]));
    const ids = [...known.keys()].filter(Boolean).sort((a, b) => b.length - a.length).map(escape);
    const uuid = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
    const pattern = new RegExp(`(?<![a-zA-Z0-9_-])(?:${[...ids, uuid].join("|")})(?![a-zA-Z0-9_-])`, "gi");
    const occurrences: ImageReferenceOccurrence[] = [];
    const missing = new Map<string, string>();
    let text = "", cursor = 0;
    for (const match of raw.matchAll(pattern)) {
        let rawStart = match.index!, rawEnd = rawStart + match[0].length;
        if (rawStart < cursor) continue;
        const id = match[0], image = known.get(id);
        // Fold the old "filename (ID)" notation into one visible token.
        const names = image ? [image.name, imageReferenceName(image.name) + "图", imageReferenceName(image.name), "参考图"] : [];
        const prefix = names.length ? new RegExp(`(?:[“"「]?(?:${names.map(escape).join("|")})[”"」]?\\s*)([（(]\\s*)?$`, "i")
            .exec(raw.slice(cursor, rawStart)) : null;
        if (prefix) {
            rawStart -= prefix[0].length;
            if (prefix[1]) rawEnd += /^\s*[）)]/.exec(raw.slice(rawEnd))?.[0].length || 0;
        }
        if (!image && !missing.has(id)) missing.set(id, `【图已移除 ${missing.size + 1}】`);
        const label = image?.label || missing.get(id)!;
        text += raw.slice(cursor, rawStart);
        const start = text.length;
        text += label;
        occurrences.push({ start, end: text.length, rawStart, rawEnd, rawText: raw.slice(rawStart, rawEnd), id, label, image });
        cursor = rawEnd;
    }
    text += raw.slice(cursor);
    const position = (offset: number) => {
        let shift = 0;
        for (const item of occurrences) {
            if (offset < item.rawStart) break;
            if (offset <= item.rawEnd) return item.start + Math.round((offset - item.rawStart) * (item.end - item.start) / (item.rawEnd - item.rawStart));
            shift += item.end - item.start - (item.rawEnd - item.rawStart);
        }
        return offset + shift;
    };
    return { text, occurrences, position };
}
export function restoreImageReferences(draft: string, projection: ReturnType<typeof projectImageReferences>, images: ImageReferenceLabel[]) {
    const labels = new Map([...images.map(image => [image.label, image.id] as const),
        ...projection.occurrences.map(item => [item.label, item.id] as const)]);
    const originals = new Map<string, string[]>();
    for (const item of projection.occurrences) originals.set(item.label, [...originals.get(item.label) || [], item.rawText]);
    return draft.replace(/【\s*(?:参考图|图)(?:已移除)?\s*\d+[^【】]*】/g, label => {
        const id = labels.get(label);
        if (!id) throw Error("图片引用标签需保持完整，请选择整个标签后删除或替换。");
        return originals.get(label)?.shift() ?? id;
    });
}
