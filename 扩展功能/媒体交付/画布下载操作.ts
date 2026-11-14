// 画布单文件/批次下载共用原图读取、命名和扩展名规则，不读缩略图。
import { useCallback, useEffect, useRef, useState } from "react";
import { zip } from "fflate";
import type { MessageInstance } from "antd/es/message/interface";
import { saveAs } from "file-saver";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { audioExtension } from "@/lib/canvas/canvas-generation-helpers";
import { readDownloadBlob } from "../画布迁移扩展/media-download";
import { generatedImageName } from "./生成图片命名";
import { mediaFileExtension } from "../生成历史/媒体文件扩展";

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_");
type SelectedDownloadFile = { kind: "image" | "video" | "audio"; storageKey?: string; url?: string; name: string };
export function selectedDownloadFiles(nodes: CanvasNodeData[]) {
    return nodes.flatMap<SelectedDownloadFile>(node => {
        const kind = node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : node.type === CanvasNodeType.Image ? "image" : null;
        if (!kind) return [];
        const images = kind === "image" ? node.metadata?.images?.filter(image => image.status === "success" && (image.content || image.storageKey)) : undefined;
        if (images?.length) return images.map(image => ({ kind, storageKey: image.storageKey, url: image.content, name: generatedImageName(node, image.id) }));
        return node.metadata?.status !== "error" && (node.metadata?.content || node.metadata?.storageKey)
            ? [{ kind, storageKey: node.metadata.storageKey, url: node.metadata.content, name: kind === "image" ? generatedImageName(node, node.metadata.primaryImageId) : node.title || `canvas-${node.type}-${node.id}` }] : [];
    });
}

export function useCanvasMediaDownloads(message: MessageInstance) {
    const [downloadingSelection, setDownloadingSelection] = useState(false);
    const downloading = useRef(false), mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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

    const downloadSelected = useCallback(async (nodes: CanvasNodeData[]) => {
        const files = selectedDownloadFiles(nodes);
        if (downloading.current || !files.length) return;
        downloading.current = true; setDownloadingSelection(true);
        try {
            const archive: Record<string, Uint8Array> = {};
            let failed = 0;
            for (const file of files) {
                if (!mounted.current) return;
                try {
                    const blob = await readDownloadBlob(file);
                    const ext = file.kind === "audio" ? audioExtension(blob.type) : mediaFileExtension(blob.type, file.kind);
                    const stem = safeName(file.name) || "未命名文件";
                    let name = `${stem}.${ext}`;
                    for (let suffix = 2; archive[name]; suffix++) name = `${stem}-${suffix}.${ext}`;
                    archive[name] = new Uint8Array(await blob.arrayBuffer());
                } catch { failed++; }
            }
            if (!mounted.current) return;
            const count = Object.keys(archive).length;
            if (!count) { message.error("所选文件无法读取，请核对原文件是否可用"); return; }
            const bytes = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => zip(archive, { level: 0 }, (error, data) => error ? reject(error) : resolve(data as Uint8Array<ArrayBuffer>)));
            if (!mounted.current) return;
            const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
            const anchor = document.createElement("a");
            anchor.href = url; anchor.download = "所选文件.zip"; anchor.style.display = "none";
            document.body.appendChild(anchor); anchor.click();
            window.setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); }, 60_000);
            if (failed) message.warning(`已下载 ${count} 个文件，跳过 ${failed} 个无法读取的文件`);
        } catch (error) { if (mounted.current) message.error(error instanceof Error ? error.message : "下载失败"); }
        finally { downloading.current = false; if (mounted.current) setDownloadingSelection(false); }
    }, [message]);
    return { downloadNodeImage, downloadBatchImage, downloadSelected, downloadingSelection };
}
