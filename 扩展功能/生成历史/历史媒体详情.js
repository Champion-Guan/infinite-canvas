function channelValue(value) {
    if (typeof value !== "string") return "";
    const text = value.trim();
    return text && !/^(?:暂无|未知|渠道未知|模型未知|none|null|undefined)$/i.test(text) ? text : "";
}

function resolveChannel(media, metadata, channels) {
    const rawChannel = channelValue(media.channelName) || channelValue(media.channel) || channelValue(media.provider)
        || channelValue(metadata.channelName) || channelValue(metadata.channel) || channelValue(metadata.provider);
    const models = [media.model, metadata.model].map(channelValue).filter(Boolean);
    const encoded = models.find(model => model.includes("::")) || "";
    const channelId = channelValue(media.channelId) || channelValue(metadata.channelId)
        || (encoded ? encoded.slice(0, encoded.indexOf("::")) : "");
    const modelName = models.map(model => model.includes("::") ? model.slice(model.indexOf("::") + 2) : model).find(Boolean) || "";
    const matched = channels.find(channel => channel.id === channelId || channel.id === rawChannel);
    const modelMatches = modelName
        ? channels.filter(channel => Array.isArray(channel.models) && channel.models.some(model => model?.name === modelName))
        : [];
    const modelMatch = modelMatches.length === 1 ? modelMatches[0] : undefined;
    return {
        channel: matched?.name || modelMatch?.name || (rawChannel && rawChannel !== channelId ? rawChannel : "") || channelId || "渠道未知",
        channelId: channelId || matched?.id || modelMatch?.id || "",
    };
}

// Match the displayed primary image. Never substitute requested or upstream-original dimensions.
export function historyMediaInfo(node, channels = []) {
    const metadata = node.metadata || {};
    const images = metadata.images || [];
    const media = images.find(image => image.id === metadata.primaryImageId)
        || images.find(image => image.content && image.content === metadata.content)
        || images.find(image => image.content)
        || metadata;
    const width = media.naturalWidth;
    const height = media.naturalHeight;
    const mime = String(media.mimeType || "").split(";", 1)[0].toLowerCase();
    const format = ({ "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WEBP", "image/gif": "GIF", "image/avif": "AVIF", "video/mp4": "MP4", "video/webm": "WEBM", "video/quicktime": "MOV" })[mime]
        || (mime.includes("/") ? mime.split("/")[1].toUpperCase() : "格式未知");
    const channelInfo = resolveChannel(media, metadata, channels);
    return {
        channel: channelInfo.channel,
        channelId: channelInfo.channelId,
        transport: metadata.transport || "",
        model: metadata.model || "模型未知",
        dimensions: width > 0 && height > 0 ? `${width}x${height}` : "尺寸未知",
        bytes: media.bytes > 0 ? media.bytes : 0,
        format,
    };
}
