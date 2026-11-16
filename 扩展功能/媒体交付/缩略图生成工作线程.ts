import { getThumbnailDimensions } from "@/lib/image-thumbnail";

type Request = { blob: Blob; maxEdge: number };
const scope = globalThis as unknown as {
    onmessage: ((event: MessageEvent<Request>) => void) | null;
    postMessage(value: { blob?: Blob; error?: string }): void;
};

scope.onmessage = async ({ data }) => {
    let bitmap: ImageBitmap | undefined, canvas: OffscreenCanvas | undefined;
    try {
        bitmap = await createImageBitmap(data.blob);
        const { width, height } = getThumbnailDimensions(bitmap.width, bitmap.height, data.maxEdge);
        if (width === bitmap.width && height === bitmap.height) { scope.postMessage({}); return; }
        canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("后台图像画布不可用");
        context.drawImage(bitmap, 0, 0, width, height);
        bitmap.close(); bitmap = undefined;
        scope.postMessage({ blob: await canvas.convertToBlob({ type: "image/webp", quality: .86 }) });
    } catch (error) {
        scope.postMessage({ error: error instanceof Error ? error.message : "后台缩略图生成失败" });
    } finally {
        bitmap?.close();
        if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
};
