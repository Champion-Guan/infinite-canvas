import { useEffect, useState } from "react";
import { CanvasNodeType } from "@/types/canvas";
import { readDownloadBlob } from "../画布迁移扩展/media-download";
import type { HistoryDownloadFile } from "./历史下载文件";

// 详情读取原持久媒体；临时预览URL只属于当前组件，移除时释放。
export function useHistoryMediaPreview(file: HistoryDownloadFile) {
    const { content, storageKey, node } = file;
    const kind = node.type === CanvasNodeType.Video ? "video" : "image";
    const [preview, setPreview] = useState<{ url?: string; error?: string }>({});
    useEffect(() => {
        let active = true, url: string | undefined;
        setPreview({});
        void readDownloadBlob({ kind, storageKey, url: content }).then(blob => {
            if (!active) return;
            url = URL.createObjectURL(blob);
            setPreview({ url });
        }).catch(error => {
            if (active) setPreview({ error: error instanceof Error ? error.message : "媒体读取失败" });
        });
        return () => { active = false; if (url) URL.revokeObjectURL(url); };
    }, [content, storageKey, kind]);
    return preview;
}
