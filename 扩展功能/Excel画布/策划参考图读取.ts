import { imageToDataUrl } from "@/services/image-storage";
import { getThumbnailDimensions } from "@/lib/image-thumbnail";
import type { ProductMainImage } from "./产品主图规则";

export const PLANNING_IMAGE_BUDGET = 90 * 1024 * 1024;
export const planningImageLimit = (count: number) => Math.floor(PLANNING_IMAGE_BUDGET / Math.max(1, count));

// 仅缩小发给文字模型的分析副本；产品原图、变体配图和生图参考图保持原样。
export async function readPlanningReference(image: ProductMainImage, count: number, signal: AbortSignal) {
    signal.throwIfAborted();
    const url = await imageToDataUrl({ storageKey: image.storageKey, url: image.url }, { signal });
    signal.throwIfAborted();
    if (!url) throw Error(`无法读取“${image.name}”，未提交策划。`);
    const limit = planningImageLimit(count);
    if (url.length <= limit) return url;
    const match = url.match(/^data:(image\/[^;,]+);base64,([\s\S]+)$/);
    if (!match) throw Error(`“${image.name}”无法准备策划参考图，未提交策划。`);
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: match[1] }));
    const canvas = document.createElement("canvas");
    try {
        const context = canvas.getContext("2d");
        if (!context) throw Error("无法准备策划参考图，请重试。");
        for (const edge of [2048, 1536, 1024]) {
            const size = getThumbnailDimensions(bitmap.width, bitmap.height, edge);
            canvas.width = size.width; canvas.height = size.height;
            context.drawImage(bitmap, 0, 0, size.width, size.height);
            for (const quality of [.86, .72, .58]) {
                signal.throwIfAborted();
                const result = canvas.toDataURL("image/webp", quality);
                if (result.startsWith("data:" + "image/") && result.length <= limit) return result;
            }
        }
        throw Error(`“${image.name}”压缩后仍超过策划参考图预算，请减少本次参考图；未提交策划。`);
    } finally {
        bitmap.close(); canvas.width = 0; canvas.height = 0;
    }
}
