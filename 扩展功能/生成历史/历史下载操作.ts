import { useCallback, useEffect, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { zipSync } from "fflate";
import { CanvasNodeType } from "@/types/canvas";
import { readDownloadBlob } from "../画布迁移扩展/media-download";
import { mediaFileExtension } from "./媒体文件扩展";
import type { HistoryDownloadFile } from "./历史下载文件";

type Messages = { info: (text: string) => unknown; error: (text: string) => unknown; warning: (text: string) => unknown };
const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_");

export function useHistoryDownloads(message: Messages) {
    const [downloading, setDownloading] = useState(false);
    const guard = useRef(false), mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const downloadFiles = useCallback(async (files: HistoryDownloadFile[], single = false) => {
        if (guard.current) return;
        if (!files.length) { message.info("请选择要下载的文件"); return; }
        guard.current = true; setDownloading(true);
        try {
            const archive: Record<string, Uint8Array> = {};
            let failed = 0;
            for (const file of files) {
                if (!mounted.current) return;
                try {
                    const kind = file.node.type === CanvasNodeType.Video ? "video" : "image";
                    const blob = await readDownloadBlob({ kind, storageKey: file.storageKey, url: file.content });
                    if (!mounted.current) return;
                    const stem = safeName(file.name), extension = mediaFileExtension(blob.type, kind);
                    if (single) { saveAs(blob, `${stem}.${extension}`); return; }
                    let name = `${stem}.${extension}`;
                    for (let suffix = 2; archive[name]; suffix++) name = `${stem}-${suffix}.${extension}`;
                    archive[name] = new Uint8Array(await blob.arrayBuffer());
                } catch (error) {
                    if (single) throw error;
                    failed++;
                }
            }
            if (!mounted.current) return;
            if (!Object.keys(archive).length) { message.error("没有可下载的有效文件，请先重新生成失败或缓存已失效的任务"); return; }
            saveAs(new Blob([zipSync(archive, { level: 0 })], { type: "application/zip" }), "生成历史.zip");
            if (failed) message.warning(`已下载 ${Object.keys(archive).length} 个文件，跳过 ${failed} 个无法读取的文件`);
        } catch (error) { if (mounted.current) message.error(error instanceof Error ? error.message : "下载失败"); }
        finally { guard.current = false; if (mounted.current) setDownloading(false); }
    }, [message]);
    return { downloading, downloadFile: (file: HistoryDownloadFile) => downloadFiles([file], true), downloadAll: downloadFiles };
}
