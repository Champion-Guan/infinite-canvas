import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useInView } from "motion/react";
import { Checkbox, Empty, Modal, Spin } from "antd";
import { Download, Image as ImageIcon, Video } from "lucide-react";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { decodeChannelModel } from "@/stores/use-config-store";
import { previewUrlFor } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { HistoryDownloadFile } from "./历史下载文件";
import { historyMediaInfo } from "./历史媒体详情";
import { useHistoryMediaPreview } from "./历史媒体预览";
import styles from "./历史总览面板.module.css";

function MediaPreview({ file, deferred = false }: { file: HistoryDownloadFile; deferred?: boolean }) {
    const container = useRef<HTMLDivElement>(null);
    const inView = useInView(container, { once: true, margin: "200px 0px" });
    const enabled = !deferred || inView || typeof IntersectionObserver === "undefined";
    const preview = useHistoryMediaPreview(file, enabled);
    const slot = file.node.metadata?.images?.find(image => image.id === file.imageId);
    const width = slot?.naturalWidth || file.node.metadata?.naturalWidth;
    const height = slot?.naturalHeight || file.node.metadata?.naturalHeight;
    return <div ref={container} className={styles.preview} style={{ aspectRatio: width && height ? `${width} / ${height}` : undefined }}>
    {preview.error ? <p role="alert">{preview.error}</p> : !preview.url ? <div className={styles.loading}>{enabled ? <Spin aria-label="正在读取媒体" /> : <span>滚动到此处查看图片</span>}</div> : file.node.type === CanvasNodeType.Video
        ? <video className={styles.media} src={preview.url} controls preload="metadata" />
        : <img className={styles.media} src={preview.url} alt={file.name} loading="lazy" decoding="async" />}
    </div>;
}

function FileDetails({ file, busy, onDownload }: { file: HistoryDownloadFile; busy: boolean; onDownload: (file: HistoryDownloadFile) => void }) {
    const slot = file.node.metadata?.images?.find(image => image.id === file.imageId);
    const node = slot ? { ...file.node, metadata: { ...file.node.metadata, images: [slot], primaryImageId: slot.id } } : file.node;
    const info = historyMediaInfo(node);
    return <article className={styles.detail} aria-label={`图片详情 ${file.name}`}>
        <div className={styles.detailHeading}><h3>{file.name}</h3><button type="button" disabled={busy} onClick={() => onDownload(file)} title={`下载 ${file.name}`} aria-label={`下载 ${file.name}`}><Download size={16} /></button></div>
        <MediaPreview file={file} deferred />
        <dl className={styles.metadata}>
            <dt>渠道 / 模型</dt><dd>{info.channel} · {decodeChannelModel(info.model)?.model || info.model}</dd>
            <dt>文件</dt><dd>{info.dimensions} · {formatBytes(info.bytes) || "大小未知"} · {info.format}</dd>
            {file.node.metadata?.prompt ? <><dt>提示词</dt><dd><details><summary>查看完整提示词</summary><p>{file.node.metadata.prompt}</p></details></dd></> : null}
        </dl>
    </article>;
}

type Props = {
    history: CanvasNodeData[];
    files: HistoryDownloadFile[];
    selectedFiles: HistoryDownloadFile[];
    selectedIds: Set<string>;
    downloading: boolean;
    theme: CanvasTheme;
    onSelect: (ids: string[], checked?: boolean) => void;
    onDownload: (file: HistoryDownloadFile) => void;
    onDownloadSelected: () => void;
    onClose: () => void;
};

export function HistoryOverviewPanel({ history, files, selectedFiles, selectedIds, downloading, theme, onSelect, onDownload, onDownloadSelected, onClose }: Props) {
    const [previewFile, setPreviewFile] = useState<HistoryDownloadFile | null>(null);
    const filesByNode = useMemo(() => {
        const groups = new Map<string, HistoryDownloadFile[]>();
        for (const file of files) {
            const group = groups.get(file.node.id);
            if (group) group.push(file); else groups.set(file.node.id, [file]);
        }
        return groups;
    }, [files]);
    const variables = { "--历史背景": theme.node.panel, "--历史文字": theme.node.text, "--历史边框": theme.node.stroke, "--历史底色": theme.node.fill } as CSSProperties;
    return <Modal open title="生成历史总览" footer={null} onCancel={onClose} width="min(1440px, 94vw)" centered styles={{ body: { padding: 0 }, container: { background: theme.node.panel, color: theme.node.text } }}>
        <div className={styles.root} style={variables}>
            <section className={styles.details} aria-label="已选图片详情">
                {selectedFiles.length ? selectedFiles.map(file => <FileDetails key={file.id} file={file} busy={downloading} onDownload={onDownload} />)
                    : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择图片" />}
            </section>
            <aside className={styles.sidebar} aria-label="选择生成历史与任务">
                <div className={styles.actions}>
                    <Checkbox disabled={downloading || !files.length} checked={files.length > 0 && selectedFiles.length === files.length} indeterminate={selectedFiles.length > 0 && selectedFiles.length < files.length} onChange={event => onSelect(files.map(file => file.id), event.target.checked)}>全选</Checkbox>
                    <span>已选 {selectedFiles.length}</span>
                    <button type="button" disabled={downloading || !selectedFiles.length} onClick={onDownloadSelected}><Download size={14} />下载选中</button>
                </div>
                <div className={styles.tasks}>
                    {history.length ? history.map(node => {
                        const nodeFiles = filesByNode.get(node.id) || [];
                        const selectedCount = nodeFiles.filter(file => selectedIds.has(file.id)).length;
                        const status = ({ loading: "生成中", error: "生成失败", success: "已完成" } as Record<string, string>)[node.metadata?.status || "idle"] || "等待生成";
                        return <article key={node.id} className={styles.task}>
                            <div className={styles.taskHeading}>
                                <Checkbox aria-label={`勾选任务 ${node.title || "生成任务"}`} disabled={downloading || !nodeFiles.length} checked={nodeFiles.length > 0 && selectedCount === nodeFiles.length} indeterminate={selectedCount > 0 && selectedCount < nodeFiles.length} onChange={event => onSelect(nodeFiles.map(file => file.id), event.target.checked)} />
                                <span>{node.title || "生成任务"}</span><small>{status}</small>
                            </div>
                            {nodeFiles.map(file => <div key={file.id} className={styles.file}>
                                <Checkbox aria-label={`勾选图片 ${file.name}`} disabled={downloading} checked={selectedIds.has(file.id)} onChange={event => onSelect([file.id], event.target.checked)} />
                                <button type="button" className={styles.thumbnail} onClick={() => setPreviewFile(file)} aria-label={`预览 ${file.name}`}>
                                    {node.type === CanvasNodeType.Image ? <img src={previewUrlFor(file.storageKey) || file.content} alt="" loading="lazy" decoding="async" /> : <Video size={20} />}
                                </button>
                                <button type="button" className={styles.fileName} disabled={downloading} onClick={() => onSelect([file.id])}>{file.name}</button>
                            </div>)}
                            {!nodeFiles.length ? <div className={styles.unavailable}><ImageIcon size={16} /><span>{node.metadata?.status === "loading" ? "图片生成中" : node.metadata?.status === "error" ? "暂无成功图片" : "暂无可读取的文件"}</span></div> : null}
                        </article>;
                    }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无生成历史" />}
                </div>
            </aside>
        </div>
        {previewFile ? <Modal open title={previewFile.name} footer={null} onCancel={() => setPreviewFile(null)} width="min(1000px, 90vw)" centered><MediaPreview key={previewFile.id} file={previewFile} /></Modal> : null}
    </Modal>;
}
