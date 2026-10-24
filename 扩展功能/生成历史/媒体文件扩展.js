export function mediaFileExtension(mimeType, kind = "image") {
    const mime = String(mimeType || "").split(";", 1)[0].trim().toLowerCase();
    return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp", "image/tiff": "tiff", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-matroska": "mkv" })[mime] || (kind === "video" ? "mp4" : "png");
}
