import { useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, useInView } from "motion/react";
import { Checkbox, Empty, Spin } from "antd";
import { AppleModal as Modal } from "../主题/苹果弹窗";
import { ArrowDownWideNarrow, Download, Image as ImageIcon, Video } from "lucide-react";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { decodeChannelModel } from "@/stores/use-config-store";
import { MediaThumbnail } from "../媒体交付/媒体缩略图";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { HistoryDownloadFile } from "./历史下载文件";
import { historyMediaInfo } from "./历史媒体详情";
import { useHistoryMediaPreview } from "./历史媒体预览";
import { HistoryVirtualList } from "./历史虚拟列表";
import { useHistorySortMotion } from "./历史排序动效";
import { estimateHistoryTaskRow, historyTaskRows, type HistoryTaskRow } from "./历史虚拟化规则";
import styles from "./历史总览面板.module.css";

const historyFileKey = (file: HistoryDownloadFile) => file.id;
const historyTaskKey = (row: HistoryTaskRow) => row.id;

function MediaPreview({ file, deferred = false }: { file: HistoryDownloadFile; deferred?: boolean }) {
    const container = useRef<HTMLDivElement>(null);
    const inView = useInView(container, { margin: "200px 0px" });
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

function FileDetails({ file, channels, busy, onDownload, promptOpen, onPromptToggle }: { file: HistoryDownloadFile; channels: Array<{ id: string; name: string }>; busy: boolean; onDownload: (file: HistoryDownloadFile) => void; promptOpen: boolean; onPromptToggle: (id: string, open: boolean) => void }) {
    const slot = file.node.metadata?.images?.find(image => image.id === file.imageId);
    const node = slot ? { ...file.node, metadata: { ...file.node.metadata, images: [slot], primaryImageId: slot.id } } : file.node;
    const info = historyMediaInfo(node, channels);
    return <article className={styles.detail} aria-label={`图片详情 ${file.name}`}>
        <div className={styles.detailHeading}><h3>{file.name}</h3><button type="button" disabled={busy} onClick={() => onDownload(file)} title={`下载 ${file.name}`} aria-label={`下载 ${file.name}`}><Download size={16} /></button></div>
        <MediaPreview file={file} deferred />
        <dl className={styles.metadata}>
            <dt>渠道 / 模型</dt><dd>{info.channel} · {decodeChannelModel(info.model)?.model || info.model}</dd>
            <dt>文件</dt><dd>{info.dimensions} · {formatBytes(info.bytes) || "大小未知"} · {info.format}</dd>
            {file.node.metadata?.prompt ? <><dt>提示词</dt><dd><details open={promptOpen} onToggle={event => onPromptToggle(file.id, event.currentTarget.open)}><summary>查看完整提示词</summary><p>{file.node.metadata.prompt}</p></details></dd></> : null}
        </dl>
    </article>;
}

type Props = {
    history: CanvasNodeData[];
    files: HistoryDownloadFile[];
    selectedFiles: HistoryDownloadFile[];
    selectedIds: Set<string>;
    channels: Array<{ id: string; name: string }>;
    sorted: boolean;
    downloading: boolean;
    theme: CanvasTheme;
    onSelect: (ids: string[], checked?: boolean) => void;
    onDownload: (file: HistoryDownloadFile) => void;
    onDownloadSelected: () => void;
    onToggleSort: () => void;
    onClose: () => void;
};

export function HistoryOverviewPanel({ history, files, selectedFiles, selectedIds, channels, sorted, downloading, theme, onSelect, onDownload, onDownloadSelected, onToggleSort, onClose }: Props) {
    const sortMotion = useHistorySortMotion(sorted);
    const [previewFile, setPreviewFile] = useState<HistoryDownloadFile | null>(null);
    const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
    const togglePrompt = (id: string, open: boolean) => setExpandedPrompts(previous => {
        if (previous.has(id) === open) return previous;
        const next = new Set(previous);
        if (open) next.add(id); else next.delete(id);
        return next;
    });
    const taskOffset = useRef(0);
    const detailOffset = useRef(0);
    const filesByNode = useMemo(() => {
        const groups = new Map<string, HistoryDownloadFile[]>();
        for (const file of files) {
            const group = groups.get(file.node.id);
            if (group) group.push(file); else groups.set(file.node.id, [file]);
        }
        return groups;
    }, [files]);
    const taskRows = useMemo(() => historyTaskRows(history, filesByNode), [history, filesByNode]);
    const selectedByNode = useMemo(() => {
        const counts = new Map<string, number>();
        for (const file of selectedFiles) counts.set(file.node.id, (counts.get(file.node.id) || 0) + 1);
        return counts;
    }, [selectedFiles]);
    const variables = { "--历史背景": theme.node.panel, "--历史文字": theme.node.text, "--历史边框": theme.node.stroke, "--历史底色": theme.node.fill } as CSSProperties;
    return <Modal open title="生成历史总览" footer={null} onCancel={onClose} width="min(1440px, 94vw)" centered styles={{ body: { padding: 0 }, container: { background: theme.node.panel, color: theme.node.text } }}>
        <div ref={sortMotion.root} className={styles.root} style={variables}>
            {selectedFiles.length ? <HistoryVirtualList items={selectedFiles} getKey={historyFileKey} estimateSize={480} gap={16} paddingX={20} paddingY={16}
                minColumnWidth={300} label="已选图片详情" className={styles.details} resetKey={sorted} offsetRef={detailOffset} animateSort>
                {file => <FileDetails key={file.id} file={file} channels={channels} busy={downloading} onDownload={onDownload} promptOpen={expandedPrompts.has(file.id)} onPromptToggle={togglePrompt} />}
            </HistoryVirtualList> : <section className={styles.details} aria-label="已选图片详情"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择图片" /></section>}
            <aside className={styles.sidebar} aria-label="选择生成历史与任务">
                <div className={styles.actions}>
                    <Checkbox disabled={downloading || !files.length} checked={files.length > 0 && selectedFiles.length === files.length} indeterminate={selectedFiles.length > 0 && selectedFiles.length < files.length} onChange={event => onSelect(files.map(file => file.id), event.target.checked)}>全选</Checkbox>
                    <span>已选 {selectedFiles.length}</span>
                    <div className={styles.actionButtons}>
                        <button type="button" className={styles.sortButton} disabled={!history.length} aria-label="排序" aria-pressed={sorted} title={sorted ? "排序：当前先按末尾数字编号，再按名称排列；点击恢复生成任务请求顺序" : "排序：先按末尾 -1、-2 等数字编号排列，同一编号再按名称排列"} onClick={() => { sortMotion.capture(); onToggleSort(); }}><ArrowDownWideNarrow size={14} />排序</button>
                        <button type="button" disabled={downloading || !selectedFiles.length} onClick={onDownloadSelected}><Download size={14} />下载选中</button>
                    </div>
                </div>
                    {history.length ? <HistoryVirtualList items={taskRows} getKey={historyTaskKey} estimateSize={estimateHistoryTaskRow} paddingX={18} paddingY={12}
                        label="生成历史任务列表" className={styles.tasks} resetKey={sorted} offsetRef={taskOffset} animateSort>
                    {row => {
                        const { node, file } = row;
                        const nodeFiles = filesByNode.get(node.id) || [];
                        const singleFile = nodeFiles.length === 1;
                        const selectedCount = selectedByNode.get(node.id) || 0;
                        const status = ({ loading: "生成中", error: "生成失败", success: "已完成" } as Record<string, string>)[node.metadata?.status || "idle"] || "等待生成";
                        return <div key={row.id} style={{ paddingBottom: row.last ? 12 : 0 }}>
                        <article className={`${styles.task} ${row.first ? styles.taskStart : ""} ${row.last ? styles.taskEnd : ""}`}>
                            {row.kind === "heading" || row.kind === "empty" ? <div className={styles.taskHeading}>
                                <Checkbox aria-label={`勾选任务 ${node.title || "生成任务"}`} disabled={downloading || !nodeFiles.length} checked={nodeFiles.length > 0 && selectedCount === nodeFiles.length} indeterminate={selectedCount > 0 && selectedCount < nodeFiles.length} onChange={event => onSelect(nodeFiles.map(file => file.id), event.target.checked)} />
                                <span>{node.title || "生成任务"}</span><small>{status}</small>
                            </div> : null}
                            {file ? <div className={styles.file}>
                                <Checkbox aria-label={`勾选图片 ${file.name}`} disabled={downloading} checked={selectedIds.has(file.id)} onChange={event => onSelect([file.id], event.target.checked)} />
                                <button type="button" className={styles.thumbnail} onClick={() => setPreviewFile(file)} aria-label={`预览 ${file.name}`}>
                                    {node.type === CanvasNodeType.Image ? <MediaThumbnail storageKey={file.storageKey} fallback={file.content} className="size-full object-cover" /> : <Video size={20} />}
                                </button>
                                <button type="button" className={styles.fileName} disabled={downloading} onClick={() => onSelect([file.id])}>{file.name}</button>
                                {singleFile ? <small className={styles.fileStatus}>{status}</small> : null}
                            </div> : null}
                            {row.kind === "empty" ? <div className={styles.unavailable}><ImageIcon size={16} /><span>{node.metadata?.status === "loading" ? "图片生成中" : node.metadata?.status === "error" ? "暂无成功图片" : "暂无可读取的文件"}</span></div> : null}
                        </article></div>;
                    }}
                    </HistoryVirtualList> : <div className={styles.tasks}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无生成历史" /></div>}
            </aside>
        </div>
        <AnimatePresence>{previewFile ? <Modal key={previewFile.id} open title={previewFile.name} footer={null} onCancel={() => setPreviewFile(null)} width="min(1000px, 90vw)" centered><MediaPreview key={previewFile.id} file={previewFile} /></Modal> : null}</AnimatePresence>
    </Modal>;
}
