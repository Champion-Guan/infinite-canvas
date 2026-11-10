import type { CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

export const MAX_IMAGE_REFERENCES = 14;

export function assertImageReferenceLimit(references: readonly unknown[]) {
    if (references.length > MAX_IMAGE_REFERENCES)
        throw new Error(`参考图最多支持 ${MAX_IMAGE_REFERENCES} 张，当前有 ${references.length} 张。请减少参考图后再生成。`);
}

export function imageGenerationReferences(source: CanvasNodeData | undefined, references: ReferenceImage[], overwrite = false) {
    const own: ReferenceImage[] = source?.type === "image" && source.metadata?.content && !overwrite
        ? [{ id: source.id, name: `${source.title || source.id}.png`, type: source.metadata.mimeType || "image/png",
            dataUrl: source.metadata.content, storageKey: source.metadata.storageKey }] : [];
    return [...new Map([...own, ...references].map(image => [image.id, image])).values()];
}
