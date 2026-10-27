import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { generatedImageName } from "./生成图片命名";

type LegacyOriginal = { width: number; height: number; storageKey?: string; mimeType?: string };
type DetailMedia = CanvasNodeMetadata & { originalImage?: LegacyOriginal };

/** 详情与下载始终指向同一张文件；批次不能用主图元数据冒充其他槽位。 */
export function imageDetailData(node: CanvasNodeData, imageId?: string | null) {
    const metadata = node.metadata || {};
    const images = metadata.images || [];
    const image = imageId ? images.find(item => item.id === imageId)
        : images.find(item => item.id === metadata.primaryImageId)
            || images.find(item => item.content === metadata.content && item.content)
            || images.find(item => item.content || item.storageKey);
    if (imageId && !image) return null;
    const media = (image || metadata) as DetailMedia;
    const isPrimary = !image || image.id === metadata.primaryImageId || Boolean(image.content && image.content === metadata.content);
    const content = media.content || "";
    if (!content && !media.storageKey) return null;
    const original: LegacyOriginal | undefined = media.originalImage || (!image ? metadata.originalImage : undefined);
    const width = media.naturalWidth, height = media.naturalHeight;
    const dimensions = width && height ? `${width}x${height}` : "暂无";
    const responseWidth = media.originalWidth || original?.width || width;
    const responseHeight = media.originalHeight || original?.height || height;
    const responseDimensions = responseWidth && responseHeight ? `${responseWidth}x${responseHeight}` : "暂无";
    const requestedDimensions = media.requestedSize || metadata.requestedSize || metadata.size || "暂无";
    const normalizedRequested = requestedDimensions.match(/^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i);
    const sizeMatches = Boolean(normalizedRequested && Number(normalizedRequested[1]) === responseWidth && Number(normalizedRequested[2]) === responseHeight);
    const mimeType = media.mimeType || content.match(/^data:([^;,]+)/i)?.[1] || "";
    const format = mimeType.startsWith("image/") ? mimeType.slice(6).split("+", 1)[0].replace(/^jpeg$/i, "jpg").toLowerCase() : "暂无";
    const originalStorageKey = media.originalStorageKey || original?.storageKey;
    const name = image ? generatedImageName(node, image.id) : node.title || "未命名图片";
    return {
        file: { id: JSON.stringify([node.id, image?.id]), imageId: image?.id, node, name, content, storageKey: media.storageKey },
        bytes: media.bytes || 0, format, dimensions, responseDimensions, requestedDimensions, sizeMatches,
        originalStorageKey, deliveryNote: media.deliveryNote || (isPrimary ? metadata.deliveryNote : undefined),
        upstreamSize: media.upstreamSize || metadata.upstreamSize,
        hasOriginal: Boolean(original || originalStorageKey || media.originalWidth),
        source: metadata.generationType === "edit" ? "图片编辑" : metadata.generationType === "generation" ? "AI 生图" : "画布图片",
        imageType: metadata.generationImageType || metadata.generationType || "暂无",
        moderation: metadata.moderation || (/gpt-image/i.test(metadata.model || "") ? "auto" : "暂无"),
        background: metadata.background === "transparent" ? "透明" : metadata.background || "暂无",
    };
}
