// 画布单文件/批次下载共用原图读取、命名和扩展名规则，不读缩略图。
import { useCallback } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import { saveAs } from "file-saver";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { audioExtension } from "@/lib/canvas/canvas-generation-helpers";
import { readDownloadBlob } from "../画布迁移扩展/media-download";
import { generatedImageName } from "./生成图片命名";
import { mediaFileExtension } from "../生成历史/媒体文件扩展";

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_");
export function useCanvasMediaDownloads(message: MessageInstance) {
    const downloadNodeImage = useCallback(async (node: CanvasNodeData) => {
        if ((node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio)
            || (!node.metadata?.content && !node.metadata?.storageKey)) return;
        try {
            const kind = node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image";
            const blob = await readDownloadBlob({ kind, storageKey: node.metadata.storageKey, url: node.metadata.content });
            const name = node.type === CanvasNodeType.Image ? generatedImageName(node, node.metadata.primaryImageId) : node.title || `canvas-${node.type}-${node.id}`;
            const extension = kind === "audio" ? audioExtension(blob.type) : mediaFileExtension(blob.type, kind);
            saveAs(blob, `${safeName(name)}.${extension}`);
        } catch (error) { message.error(error instanceof Error ? error.message : "下载失败"); }
    }, [message]);

    const downloadBatchImage = useCallback(async (node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find(item => item.id === imageId);
        if (!image?.content && !image?.storageKey) return;
        try {
            const blob = await readDownloadBlob({ kind: "image", storageKey: image.storageKey, url: image.content });
            saveAs(blob, `${safeName(generatedImageName(node, imageId))}.${mediaFileExtension(blob.type)}`);
        } catch (error) { message.error(error instanceof Error ? error.message : "下载失败"); }
    }, [message]);

    return { downloadNodeImage, downloadBatchImage };
}
