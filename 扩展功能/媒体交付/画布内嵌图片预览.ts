import { deferredCanvasMediaPreview, restoreCanvasMedia } from "../本机存储/画布媒体延迟恢复.mjs";
import { sqliteForage } from "../本机存储/上游浏览器存储桥";
import { createThumbnailCache } from "./缩略图缓存";
import { createImageThumbnailInBackground } from "./缩略图后台生成";
import { createImageThumbnail } from "@/lib/image-thumbnail";
import { validImageSource } from "./图片解码交接";

const previews = createThumbnailCache({ maxEntries: 512, maxBytes: 16 * 1024 * 1024 });
let previewStore: ReturnType<typeof sqliteForage.createInstance> | undefined;
const sourceKeys = new WeakMap<object, Promise<string>>();
export const isEmbeddedCanvasImage = (source?: string) => Boolean(source && deferredCanvasMediaPreview(source));

function persistentKey(source: { identity: string }) {
    let key = sourceKeys.get(source);
    if (!key) {
        key = crypto.subtle.digest("SHA-256", new TextEncoder().encode(source.identity))
            .then(hash => [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join(""));
        sourceKeys.set(source, key);
    }
    return key;
}

// 旧产品包可能只在画布分片中带原图，存储键并不保证image_files中存在原件。
export async function resolveEmbeddedCanvasPreview(fallback: string | undefined, edge: number) {
    if (!fallback) return undefined;
    if (edge === Infinity) return validImageSource(await restoreCanvasMedia(fallback));
    const embedded = deferredCanvasMediaPreview(fallback);
    return previews.resolve(`${edge}:${embedded?.identity || fallback}`, async () => {
        let key: string | undefined;
        if (embedded?.identity) {
            key = `embedded-preview:v1:${edge}:${await persistentKey(embedded)}`;
            previewStore ??= sqliteForage.createInstance({ name: "infinite-canvas", storeName: "image_previews" });
            const saved = await previewStore.getItem<{ version: number; blob: Blob }>(key).catch(() => null);
            if (saved?.version === 1 && saved.blob instanceof Blob) return saved.blob;
        }
        let blob: Blob;
        if (embedded?.readBlob) blob = await embedded.readBlob();
        else {
            const source = validImageSource(await restoreCanvasMedia(fallback));
            if (!source) return undefined;
            const response = await fetch(source);
            if (!response.ok) throw new Error("内嵌图片读取失败");
            blob = await response.blob();
        }
        const result = await createImageThumbnailInBackground(blob, () => createImageThumbnail(blob, edge), edge) || blob;
        // 派生缓存落盘不阻塞第一张画面；页面关闭仍由既有SQLite排空门禁保护。
        if (key) void Promise.resolve().then(() => previewStore!.setItem(key!, { version: 1, blob: result })).catch(() => {});
        return result;
    });
}
