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
import { historyMediaInfo } from "./历史媒体详情";
import { sortGenerationHistory } from "./历史排序";
import { useHistoryDownloads } from "./历史下载操作";
import { useHistorySelection } from "./历史选择操作";
import { HistoryOverviewPanel } from "./历史总览面板";
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
        const files: Array<{ id: string; storageKey?: string; content: string; type: string }> = JSON.parse(cacheManifest);
        void Promise.all(files.map(async (file) => {
            if (!file.storageKey) return null;
            const blob = file.type === CanvasNodeType.Video ? await getMediaBlob(file.storageKey).catch(() => null) : await getImageBlob(file.storageKey).catch(() => null);
            // An external URL can still recover a missing local cache through readDownloadBlob.
            return blob?.size || /^https?:/i.test(file.content) ? null : file.id;
        })).then((ids) => {
            if (!cancelled) setInvalidFileIds(new Set(ids.filter((id): id is string => Boolean(id))));
        });
        return () => { cancelled = true; };
    }, [cacheManifest]);
    const validCompletedFiles = useMemo(() => completedFiles.filter(file => !invalidFileIds.has(file.id)), [completedFiles, invalidFileIds]);
    const { selectionMode, selectedFiles: selectedHistoryFiles, selectedIds: selectedHistoryIds, selectFiles, toggleSelectionMode, beginOverviewSelection } = useHistorySelection(validCompletedFiles, downloading);
    const downloadableIds = new Set(validCompletedFiles.map(file => file.node.id));
    const selectedHistoryCount = selectedHistoryFiles.length;
    const invalidFilesForNode = (node: CanvasNodeData) => completedFiles.filter(file => file.node.id === node.id && invalidFileIds.has(file.id));
    const toggleHistorySelection = (id: string) => {
        selectFiles(validCompletedFiles.filter(file => file.node.id === id).map(file => file.id));
    };
    const failed = failedTaskTargets(history, connections);
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
        <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-1">
                <span className="text-xs font-medium opacity-60">生成任务 / 生成历史</span>
                <span className="text-xs opacity-35">{history.length}</span>
                <button type="button" disabled={!history.length} onClick={() => { const transition = (document as Document & { startViewTransition?: (callback: () => void) => unknown }).startViewTransition; if (transition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) transition(toggleHistorySorted); else toggleHistorySorted(); }} className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40", sorted && "bg-black/5 dark:bg-white/10")} style={{ color: theme.node.text }} title={sorted ? "当前为分类顺序；点击恢复生成任务请求顺序" : "当前为生成任务请求顺序；点击按主图、详情页编号、富内容编号、其他排序，同类按图片序号排列"}>
                    <ArrowDownWideNarrow className="size-3.5" />
                    排序
                </button>
                <button type="button" disabled={retrying || !failed.length} onClick={() => void retryTargets(failed)} className="guan-history-retry-all inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" style={{ color: theme.node.text }} title="只重试当前画布生成历史中的失败任务，不重新生成成功任务">
                    <RotateCcw className="size-3.5" />
                    {retrying ? "正在重试…" : "重试"}
                </button>
                <button type="button" disabled={downloading || (!selectionMode && !validCompletedFiles.length)} onClick={toggleSelectionMode} className="guan-history-select inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" style={{ color: theme.node.text }} title={selectionMode ? "取消列表勾选模式" : "在生成历史列表中勾选要下载的卡片"}>
                    <ListChecks className="size-3.5" />
                    {selectionMode ? "取消" : "选择"}
                </button>
                <span className="inline-flex shrink-0 items-center gap-2">
                <button type="button" disabled={downloading || !validCompletedFiles.length || (selectionMode && !selectedHistoryFiles.length)} onClick={() => void downloadAll(selectionMode ? selectedHistoryFiles : validCompletedFiles)} className={cn("guan-download-action inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40", downloading && "is-loading")} style={{ color: theme.node.text }} title={!validCompletedFiles.length ? "暂无可下载的成功文件" : selectionMode ? "打包下载选择模式中勾选的文件" : "一键打包下载全部已成功生成的文件"}>
                    <Download className="guan-download-icon size-3.5" />
                    {downloading ? "正在打包…" : "下载"}
                </button>
                <button type="button" onClick={() => { beginOverviewSelection(); setOverviewOpen(true); }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} title="生成历史总览">
                    <LayoutGrid className="size-3.5" />总览
                </button>
                </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {history.length ? (
                    <div className="space-y-1.5 px-1">
                        {displayedHistory.map((node) => {
                            const info = historyMediaInfo(node);
                            const details = [info.channel, decodeChannelModel(info.model)?.model || info.model, info.dimensions, formatBytes(info.bytes) || "大小未知", info.format].join(" · ");
                            const invalidFiles = invalidFilesForNode(node);
                            const invalid = invalidFiles.length > 0;
                            const nodeFailed = failed.filter(target => target.node.id === node.id);
                            const nodeRetryTargets = [...nodeFailed, ...invalidFiles.filter(file => !nodeFailed.some(target => target.imageId === file.imageId)).map(file => ({ node, imageId: file.imageId, unavailableStorageKey: file.storageKey }))];
                            const nodeFiles = validCompletedFiles.filter(file => file.node.id === node.id);
                            const busy = node.metadata?.status === "loading" || node.metadata?.images?.some(image => image.status === "loading");
                            return (
                            <motion.div key={node.id} layout transition={{ layout: { type: "spring", stiffness: 520, damping: 34, mass: .7 } }} onClick={event => { if (selectionMode && event.target instanceof Element && !event.target.closest("button,input,label")) toggleHistorySelection(node.id); }} className={cn("guan-history-list-card flex w-full flex-wrap items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10", selectionMode && nodeFiles.some(file => selectedHistoryIds.has(file.id)) && "bg-black/5 dark:bg-white/10")}>
                                {selectionMode ? <Checkbox aria-label={`勾选${node.title || "生成任务"}`} disabled={downloading || !downloadableIds.has(node.id)} checked={nodeFiles.length > 0 && nodeFiles.every(file => selectedHistoryIds.has(file.id))} indeterminate={nodeFiles.some(file => selectedHistoryIds.has(file.id)) && !nodeFiles.every(file => selectedHistoryIds.has(file.id))} onChange={() => toggleHistorySelection(node.id)} /> : null}
                                <button type="button" onClick={() => onPreviewNode(node.id)} className="shrink-0" aria-label={`预览${node.title || "生成任务"}`}>
                                {node.type === CanvasNodeType.Image && (node.metadata?.content || node.metadata?.images?.find((image) => image.content)?.content) ? (
                                    <img src={previewUrlFor(node.metadata.storageKey) || node.metadata.content || node.metadata.images?.find((image) => image.content)?.content} alt="" className="size-10 shrink-0 rounded-md object-cover guan-image-shared-element" style={{ viewTransitionName: `guan-history-${node.id}` }} />
                                ) : (
                                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-black/5 dark:bg-white/10">
                                        {node.type === CanvasNodeType.Video ? <Video className="size-4 opacity-60" /> : <ImageIcon className="size-4 opacity-60" />}
                                    </span>
                                )}
                                </button>
                                <button type="button" disabled={selectionMode && (downloading || !downloadableIds.has(node.id))} onClick={() => selectionMode ? toggleHistorySelection(node.id) : onPreviewNode(node.id)} className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left" aria-label={`${selectionMode ? "选择" : "查看"}${node.title || "生成任务"}`}>
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
                                {!selectionMode && nodeFiles.length ? (
                                    <div className="flex w-full flex-wrap gap-1 pl-12">
                                        {nodeFiles.map(file => (
                                            <button key={file.id} type="button" disabled={downloading} onClick={() => void downloadFile(file)} className="inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] opacity-65 transition hover:bg-black/5 hover:opacity-100 disabled:opacity-40 dark:hover:bg-white/10" title={`下载 ${file.name}`} aria-label={`下载 ${file.name}`}>
                                                <Download className="size-3 shrink-0" /><span className="truncate">{file.name}</span>
                                            </button>
                                        ))}
                                    </div>
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
                    <button type="button" disabled={downloading || !selectedHistoryFiles.length} onClick={() => void downloadAll(selectedHistoryFiles)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" title="打包下载已勾选的成功文件">
                        <Download className="size-3.5" />{downloading ? "正在打包…" : "下载选中"}
                    </button>
                </div>
            ) : null}
            {overviewOpen ? <HistoryOverviewPanel history={displayedHistory} files={validCompletedFiles} selectedFiles={selectedHistoryFiles} selectedIds={selectedHistoryIds} downloading={downloading} theme={theme} onSelect={selectFiles} onDownload={file => void downloadFile(file)} onDownloadSelected={() => void downloadAll(selectedHistoryFiles)} onClose={() => setOverviewOpen(false)} /> : null}
        </div>
    );
});

