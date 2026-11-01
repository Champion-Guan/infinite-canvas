import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { generatedImageName } from "./生成图片命名";

type LegacyOriginal = { width: number; height: number; storageKey?: string; mimeType?: string };
type DetailMedia = CanvasNodeMetadata & {
    originalImage?: LegacyOriginal;
    channel?: string;
    channelId?: string;
    channelName?: string;
    provider?: string;
    model?: string;
    transport?: "direct" | "proxy";
};
type ChannelLabel = { id: string; name: string; models?: Array<{ name?: string }> };

function channelValue(value: unknown) {
    if (typeof value !== "string") return "";
    const text = value.trim();
    return text && !/^(?:暂无|未知|渠道未知|模型未知|none|null|undefined)$/i.test(text) ? text : "";
}

function resolveChannel(media: DetailMedia, metadata: CanvasNodeMetadata, channels: ChannelLabel[]) {
    const rawChannel = channelValue(media.channelName) || channelValue(media.channel) || channelValue(media.provider)
        || channelValue(metadata.channelName) || channelValue(metadata.channel) || channelValue(metadata.provider);
    const models = [media.model, metadata.model].map(channelValue).filter(Boolean);
    const encoded = models.find(model => model.includes("::")) || "";
    const channelId = channelValue(media.channelId) || channelValue(metadata.channelId)
        || (encoded ? encoded.slice(0, encoded.indexOf("::")) : "");
    const modelName = models.map(model => model.includes("::") ? model.slice(model.indexOf("::") + 2) : model).find(Boolean) || "";
    const matched = channels.find(channel => channel.id === channelId || channel.id === rawChannel);
    const modelMatches = modelName
        ? channels.filter(channel => channel.models?.some(model => model?.name === modelName))
        : [];
    const modelMatch = modelMatches.length === 1 ? modelMatches[0] : undefined;
    return {
        channel: matched?.name || modelMatch?.name || (rawChannel && rawChannel !== channelId ? rawChannel : "") || channelId || "渠道未知",
        channelId: channelId || matched?.id || modelMatch?.id || "",
    };
}

/** 详情与下载始终指向同一张文件；批次不能用主图元数据冒充其他槽位。 */
export function imageDetailData(node: CanvasNodeData, imageId?: string | null, channels: ChannelLabel[] = []) {
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
    const channelInfo = resolveChannel(media, metadata, channels);
    return {
        file: { id: JSON.stringify([node.id, image?.id]), imageId: image?.id, node, name, content, storageKey: media.storageKey },
        bytes: media.bytes || 0, format, dimensions, responseDimensions, requestedDimensions, sizeMatches,
        originalStorageKey, deliveryNote: media.deliveryNote || (isPrimary ? metadata.deliveryNote : undefined),
        upstreamSize: media.upstreamSize || metadata.upstreamSize,
        channel: channelInfo.channel,
        channelId: channelInfo.channelId,
        model: media.model || metadata.model || "模型未知",
        transport: media.transport || metadata.transport || "",
        hasOriginal: Boolean(original || originalStorageKey || media.originalWidth),
        source: metadata.generationType === "edit" ? "图片编辑" : metadata.generationType === "generation" ? "AI 生图" : "画布图片",
        imageType: metadata.generationImageType || metadata.generationType || "暂无",
        moderation: metadata.moderation || (/gpt-image/i.test(metadata.model || "") ? "auto" : "暂无"),
        background: metadata.background === "transparent" ? "透明" : metadata.background || "暂无",
    };
}
