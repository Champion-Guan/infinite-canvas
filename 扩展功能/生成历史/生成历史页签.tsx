import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { App, Checkbox, Empty } from "antd";
import { ArrowDownWideNarrow, Download, Image as ImageIcon, LayoutGrid, ListChecks, RotateCcw, Video } from "lucide-react";
import { motion } from "motion/react";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/image-utils";
import { failedTaskTargets } from "./任务摘要";
import { runHistoryRetries, type HistoryRetryTarget } from "./历史失败重试";
import { historyDownloadFiles } from "./历史下载文件";
import type { HistoryDownloadFile } from "./历史下载文件";
import { historyMediaInfo } from "./历史媒体详情";
import { sortGenerationHistory } from "./历史排序";
import { useHistoryDownloads } from "./历史下载操作";
import { useHistorySelection } from "./历史选择操作";
import { HistoryOverviewPanel } from "./历史总览面板";
import { HistoryActionButton } from "./历史操作按钮";
import actionStyles from "./历史操作栏.module.css";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob, previewUrlFor, subscribeImagePreviews, getImagePreviewRevision } from "@/services/image-storage";
import { decodeChannelModel } from "@/stores/use-config-store";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const STATUS_COLOR: Record<string, string> = { success: "#22c55e", loading: "#f59e0b", error: "#ef4444", idle: "transparent" };

export const CanvasGenerationHistoryTab = memo(function CanvasGenerationHistoryTab({ nodes, connections, getCurrentNode, onPreviewNode, onRetryNode, theme }: { nodes: CanvasNodeData[]; connections: CanvasConnection[]; getCurrentNode: (id: string) => CanvasNodeData | undefined; onPreviewNode: (nodeId: string) => void; onRetryNode: (node: CanvasNodeData, imageId?: string) => void | Promise<void>; theme: CanvasTheme }) {
    const sorted = useCanvasSidePanelStore((state) => state.historySorted);
    const toggleHistorySorted = useCanvasSidePanelStore((state) => state.toggleHistorySorted);
    const [overviewOpen, setOverviewOpen] = useState(false);
    const [retrying, setRetrying] = useState(false);
    const retryGuard = useRef(false);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const { message } = App.useApp();
    const { downloading, downloadFile, downloadAll } = useHistoryDownloads(message);
    const history = useMemo(() => nodes.filter((node) =>
        (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) &&
        Boolean(node.metadata?.generationStartedAt || node.metadata?.generationType || node.metadata?.generationImageType || node.metadata?.videoTaskId || node.metadata?.status === "loading" || node.metadata?.status === "error"),
    ), [nodes]);
    const displayedHistory = useMemo(() => sorted ? sortGenerationHistory(history) : history, [history, sorted]);
    const completedFiles = useMemo(() => historyDownloadFiles(displayedHistory), [displayedHistory]);
    const [invalidFileIds, setInvalidFileIds] = useState<Set<string>>(new Set());
    // Dragging and sorting do not reread all persisted media.
    const cacheManifest = JSON.stringify(completedFiles.map(file => ({ id: file.id, storageKey: file.storageKey, content: file.content, type: file.node.type })).sort((a, b) => a.id.localeCompare(b.id)));
    useEffect(() => {
        let cancelled = false;
        setInvalidFileIds(new Set());
        const files: Array<{ id: string; storageKey?: string; content: string; type: string }> = JSON.parse(cacheManifest);
        const unique = [...new Map(files.filter(file => file.storageKey).map(file => [`${file.type}:${file.storageKey}`, file])).values()];
        void (async () => {
            const missing = new Set<string>();
            // 限制并发并让出首屏绘制，避免打开历史页时一次性读取几百个媒体。
            for (let offset = 0; offset < unique.length && !cancelled; offset += 6) {
                const batch = unique.slice(offset, offset + 6);
                const results = await Promise.all(batch.map(async file => {
                    const blob = file.type === CanvasNodeType.Video ? await getMediaBlob(file.storageKey!).catch(() => null) : await getImageBlob(file.storageKey!).catch(() => null);
                    return { file, available: Boolean(blob?.size) };
                }));
                for (const { file, available } of results) {
                    if (available) continue;
                    for (const candidate of files) if (candidate.storageKey === file.storageKey && !/^https?:/i.test(candidate.content)) missing.add(candidate.id);
                }
                if (!cancelled) setInvalidFileIds(new Set(missing));
                if (offset + 6 < unique.length) await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
        })();
        return () => { cancelled = true; };
    }, [cacheManifest]);
    const validCompletedFiles = useMemo(() => completedFiles.filter(file => !invalidFileIds.has(file.id)), [completedFiles, invalidFileIds]);
    const { selectionMode, selectedFiles: selectedHistoryFiles, selectedIds: selectedHistoryIds, selectFiles, toggleSelectionMode, beginOverviewSelection } = useHistorySelection(validCompletedFiles, downloading);
    const filesByNode = useMemo(() => {
        const groups = new Map<string, { valid: HistoryDownloadFile[]; invalid: HistoryDownloadFile[] }>();
        for (const file of completedFiles) {
            let group = groups.get(file.node.id);
            if (!group) { group = { valid: [], invalid: [] }; groups.set(file.node.id, group); }
            (invalidFileIds.has(file.id) ? group.invalid : group.valid).push(file);
        }
        return groups;
    }, [completedFiles, invalidFileIds]);
    const selectedHistoryCount = selectedHistoryFiles.length;
    const toggleHistorySelection = (id: string) => {
        selectFiles((filesByNode.get(id)?.valid || []).map(file => file.id));
    };
    const failed = useMemo(() => failedTaskTargets(history, connections), [history, connections]);
    const failedByNode = useMemo(() => {
        const groups = new Map<string, HistoryRetryTarget[]>();
        for (const target of failed) {
            const group = groups.get(target.node.id);
            if (group) group.push(target); else groups.set(target.node.id, [target]);
        }
        return groups;
    }, [failed]);
    const retryTargets = async (targets: HistoryRetryTarget[]) => {
        if (retryGuard.current || !targets.length) return;
        retryGuard.current = true;
        setRetrying(true);
        try {
            await runHistoryRetries(targets, {
                getNode: getCurrentNode,
                isActive: () => mounted.current,
                onRetry: onRetryNode,
                onError: error => message.error(error instanceof Error ? error.message : "重试失败"),
            });
        } finally {
            retryGuard.current = false;
            if (mounted.current) setRetrying(false);
        }
    };
    return (
        <div className={cn("guan-apple-enter flex h-full flex-col", actionStyles.panel)}>
            <div className="guan-apple-stagger flex flex-wrap items-center gap-2 px-3 pb-2 pt-1">
                <span className={actionStyles.heading}>
                <span className="text-xs font-medium opacity-60">生成任务 / 生成历史</span>
                <span className="text-xs opacity-35">{history.length}</span>
                </span>
                <div className={actionStyles.actions} role="group" aria-label="生成历史操作">
                <HistoryActionButton disabled={!history.length} onClick={toggleHistorySorted} className={cn(sorted && "bg-black/5 dark:bg-white/10")} style={{ color: theme.node.text }} aria-pressed={sorted} label="排序" icon={<ArrowDownWideNarrow className="size-3.5" />} description={sorted ? "排序：当前为分类顺序；点击恢复生成任务请求顺序" : "排序：按主图、详情页编号、富内容编号、其他排序，同类按图片序号排列"} />
                <HistoryActionButton disabled={retrying || !failed.length} onClick={() => void retryTargets(failed)} className="guan-history-retry-all" style={{ color: theme.node.text }} aria-busy={retrying} label={retrying ? "正在重试…" : "重试"} icon={<RotateCcw className="size-3.5" />} description={retrying ? "正在重试失败任务" : "重试：只重试失败任务，不重新生成成功任务"} />
                <HistoryActionButton disabled={downloading || (!selectionMode && !validCompletedFiles.length)} onClick={toggleSelectionMode} className="guan-history-select" style={{ color: theme.node.text }} aria-pressed={selectionMode} label={selectionMode ? "取消" : "选择"} icon={<ListChecks className="size-3.5" />} description={selectionMode ? "取消列表勾选模式" : "选择：勾选要下载的卡片"} />
                <HistoryActionButton disabled={downloading || !validCompletedFiles.length || (selectionMode && !selectedHistoryFiles.length)} onClick={() => void downloadAll(selectionMode ? selectedHistoryFiles : validCompletedFiles)} className={cn("guan-download-action", downloading && "is-loading")} style={{ color: theme.node.text }} aria-busy={downloading} label={downloading ? "正在打包…" : "下载"} icon={<Download className="guan-download-icon size-3.5" />} description={downloading ? "正在打包下载文件" : !validCompletedFiles.length ? "下载：暂无可下载的成功文件" : selectionMode ? "下载：打包下载勾选的文件" : "下载：打包下载全部已成功生成的文件"} />
                <HistoryActionButton onClick={() => { beginOverviewSelection(); setOverviewOpen(true); }} style={{ color: theme.node.text }} label="总览" icon={<LayoutGrid className="size-3.5" />} description="总览：勾选并对照查看生成图片详情" />
                </div>
            </div>
            <div className="guan-apple-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {history.length ? (
                    <div className="space-y-1.5 px-1">
                        {displayedHistory.map((node) => {
                            const info = historyMediaInfo(node);
                            const details = [info.channel, decodeChannelModel(info.model)?.model || info.model, info.dimensions, formatBytes(info.bytes) || "大小未知", info.format].join(" · ");
                            const invalidFiles = filesByNode.get(node.id)?.invalid || [];
                            const invalid = invalidFiles.length > 0;
                            const nodeFailed = failedByNode.get(node.id) || [];
                            const nodeRetryTargets = [...nodeFailed, ...invalidFiles.filter(file => !nodeFailed.some(target => target.imageId === file.imageId)).map(file => ({ node, imageId: file.imageId, unavailableStorageKey: file.storageKey }))];
                            const nodeFiles = filesByNode.get(node.id)?.valid || [];
                            const busy = node.metadata?.status === "loading" || node.metadata?.images?.some(image => image.status === "loading");
                            return (
                            <motion.div key={node.id} layout="position" transition={{ layout: { type: "spring", stiffness: 520, damping: 34, mass: .7 } }} onClick={event => { if (selectionMode && event.target instanceof Element && !event.target.closest("button,input,label")) toggleHistorySelection(node.id); }} className={cn("guan-history-list-card flex w-full flex-wrap items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/10", selectionMode && nodeFiles.some(file => selectedHistoryIds.has(file.id)) && "bg-black/5 dark:bg-white/10")}>
                                {selectionMode ? <Checkbox aria-label={`勾选${node.title || "生成任务"}`} disabled={downloading || !nodeFiles.length} checked={nodeFiles.length > 0 && nodeFiles.every(file => selectedHistoryIds.has(file.id))} indeterminate={nodeFiles.some(file => selectedHistoryIds.has(file.id)) && !nodeFiles.every(file => selectedHistoryIds.has(file.id))} onChange={() => toggleHistorySelection(node.id)} /> : null}
                                <button type="button" onClick={() => onPreviewNode(node.id)} className="shrink-0" aria-label={`预览${node.title || "生成任务"}`}>
                                {node.type === CanvasNodeType.Image && (node.metadata?.content || node.metadata?.images?.find((image) => image.content)?.content) ? (
                                    <img src={previewUrlFor(node.metadata.storageKey) || node.metadata.content || node.metadata.images?.find((image) => image.content)?.content} alt="" loading="lazy" decoding="async" className="size-10 shrink-0 rounded-md object-cover guan-image-shared-element" style={{ viewTransitionName: `guan-history-${node.id}` }} />
                                ) : (
                                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-black/5 dark:bg-white/10">
                                        {node.type === CanvasNodeType.Video ? <Video className="size-4 opacity-60" /> : <ImageIcon className="size-4 opacity-60" />}
                                    </span>
                                )}
                                </button>
                                <button type="button" disabled={selectionMode && (downloading || !nodeFiles.length)} onClick={() => selectionMode ? toggleHistorySelection(node.id) : onPreviewNode(node.id)} className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left" aria-label={`${selectionMode ? "选择" : "查看"}${node.title || "生成任务"}`}>
                                <span className="size-2 shrink-0 rounded-full" style={{ background: invalid ? STATUS_COLOR.error : STATUS_COLOR[node.metadata?.status || "idle"] || STATUS_COLOR.idle }} />
                                <span className="min-w-0 flex-1 break-words">
                                    <span className="font-medium">{node.title || (node.type === CanvasNodeType.Video ? "生成视频" : "生成图片")}</span>
                                    <span className="guan-history-media-info ml-2 break-words text-[10px] leading-relaxed opacity-55" title={invalid ? "媒体缓存不可用" : details}>{invalid ? "媒体缓存不可用" : details}</span>
                                </span>
                                {!selectionMode ? <span className="shrink-0 opacity-55">查看</span> : null}
                                </button>
                                {nodeRetryTargets.length ? (
                                    <button type="button" disabled={retrying || busy} onClick={() => void retryTargets(nodeRetryTargets)} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-medium text-red-500 transition hover:bg-red-500/10 disabled:opacity-40" title="重试" aria-label={`重试${node.title || "生成任务"}`}>
                                        <RotateCcw className="size-3.5" />
                                        <span>重试</span>
                                    </button>
                                ) : null}
                            </motion.div>
                            );
                        })}
                    </div>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无生成历史" className="pt-16" />}
            </div>
            {selectionMode ? (
                <div className="guan-history-selection-footer flex shrink-0 items-center gap-3 border-t px-3 py-3 text-xs" style={{ borderColor: theme.node.stroke }}>
                    <Checkbox disabled={downloading || !validCompletedFiles.length} checked={validCompletedFiles.length > 0 && selectedHistoryCount === validCompletedFiles.length} indeterminate={selectedHistoryCount > 0 && selectedHistoryCount < validCompletedFiles.length} onChange={event => selectFiles(validCompletedFiles.map(file => file.id), event.target.checked)}>全选</Checkbox>
                    <span className="opacity-55">已选 {selectedHistoryCount} 个文件</span>
                    <HistoryActionButton disabled={downloading || !selectedHistoryFiles.length} onClick={() => void downloadAll(selectedHistoryFiles)} aria-busy={downloading} label={downloading ? "正在打包…" : "下载选中"} icon={<Download className="size-3.5" />} description="打包下载已勾选的成功文件" />
                </div>
            ) : null}
            {overviewOpen ? <HistoryOverviewPanel history={displayedHistory} files={validCompletedFiles} selectedFiles={selectedHistoryFiles} selectedIds={selectedHistoryIds} downloading={downloading} theme={theme} onSelect={selectFiles} onDownload={file => void downloadFile(file)} onDownloadSelected={() => void downloadAll(selectedHistoryFiles)} onClose={() => setOverviewOpen(false)} /> : null}
        </div>
    );
});

