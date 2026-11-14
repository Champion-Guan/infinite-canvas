import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useProductActive } from "../产品/产品界面边界";
import { MediaThumbnail } from "../媒体交付/媒体缩略图";
import { App, Checkbox, Empty } from "antd";
import { ArrowDownWideNarrow, Download, Image as ImageIcon, LayoutGrid, ListChecks, RotateCcw, Video } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { SelectionFooter, SelectionInline } from "../主题/选择模式动效";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/image-utils";
import { failedTaskTargets } from "./任务摘要";
import { imageSizeRetryBlocked } from "../媒体交付/生成图片尺寸交付.mjs";
import { runHistoryRetries, type HistoryRetryTarget } from "./历史失败重试";
import { historyDownloadFiles } from "./历史下载文件";
import type { HistoryDownloadFile } from "./历史下载文件";
import { historyMediaInfo } from "./历史媒体详情";
import { sortGenerationHistory } from "./历史排序";
import { useHistoryDownloads } from "./历史下载操作";
import { useHistorySelection } from "./历史选择操作";
import { HistoryOverviewPanel } from "./历史总览面板";
import { HistoryActionButton } from "./历史操作按钮";
import { HistoryVirtualList } from "./历史虚拟列表";
import actionStyles from "./历史操作栏.module.css";
import { missingHistoryMedia, type HistoryMediaRecord } from "./历史媒体可用性";
import { decodeChannelModel, useEffectiveConfig } from "@/stores/use-config-store";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const STATUS_COLOR: Record<string, string> = { success: "#22c55e", loading: "#f59e0b", error: "#ef4444", idle: "transparent" };
const historyNodeKey = (node: CanvasNodeData) => node.id;

export const CanvasGenerationHistoryTab = memo(function CanvasGenerationHistoryTab({ nodes, connections, getCurrentNode, onPreviewNode, onRetryNode, theme }: { nodes: CanvasNodeData[]; connections: CanvasConnection[]; getCurrentNode: (id: string) => CanvasNodeData | undefined; onPreviewNode: (nodeId: string) => void; onRetryNode: (node: CanvasNodeData, imageId?: string) => void | Promise<void>; theme: CanvasTheme }) {
    const productActive = useProductActive();
    const sorted = useCanvasSidePanelStore((state) => state.historySorted);
    const toggleHistorySorted = useCanvasSidePanelStore((state) => state.toggleHistorySorted);
    const [overviewOpen, setOverviewOpen] = useState(false);
    const [retrying, setRetrying] = useState(false);
    const retryGuard = useRef(false);
    const mounted = useRef(true);
    const historyOffset = useRef(0);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const { downloading, downloadFile, downloadAll } = useHistoryDownloads(message);
    const history = useMemo(() => nodes.filter((node) =>
        (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) &&
        Boolean(node.metadata?.generationStartedAt || node.metadata?.generationType || node.metadata?.generationImageType || node.metadata?.videoTaskId || node.metadata?.status === "loading" || node.metadata?.status === "error"),
    ), [nodes]);
    const displayedHistory = useMemo(() => sorted ? sortGenerationHistory(history) : history, [history, sorted]);
    const completedFiles = useMemo(() => historyDownloadFiles(displayedHistory), [displayedHistory]);
    const [invalidFileIds, setInvalidFileIds] = useState<Set<string>>(new Set());
    // Dragging and sorting do not reread all persisted media.
    const cacheManifest = JSON.stringify(completedFiles.map(file => ({ id: file.id, storageKey: file.storageKey, remote: /^https?:/i.test(file.content), type: file.node.type })).sort((a, b) => a.id.localeCompare(b.id)));
    useEffect(() => {
        if (!productActive) return;
        let cancelled = false;
        const files: HistoryMediaRecord[] = JSON.parse(cacheManifest);
        void missingHistoryMedia(files).then(missing => {
            if (!cancelled) setInvalidFileIds(missing);
        }).catch(() => {
            // 暂时读取失败不能变成“原图丢失”，更不能因此引导用户重复付费生成。
            if (!cancelled) message.warning?.("暂时无法核对媒体清单，预览和下载时将再次检查。");
        });
        return () => { cancelled = true; };
    }, [cacheManifest, productActive, message]);
    const validCompletedFiles = useMemo(() => completedFiles.filter(file => !invalidFileIds.has(file.id)), [completedFiles, invalidFileIds]);
    const { selectionMode, selectedFiles: selectedHistoryFiles, selectedIds: selectedHistoryIds, selectFiles, toggleSelectionMode, beginOverviewSelection, endOverviewSelection } = useHistorySelection(validCompletedFiles, downloading);
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
    // 保留重试、下载和勾选的所有者；仅卸下隐藏产品的图片展示。
    if (!productActive) return null;
    return (
        <div className={cn("flex h-full flex-col", actionStyles.panel)}>
            <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-1">
                <span className={actionStyles.heading}>
                <span className="text-xs font-medium opacity-60">生成任务 / 生成历史</span>
                <span className="text-xs opacity-35">{history.length}</span>
                </span>
                <div className={actionStyles.actions} role="group" aria-label="生成历史操作">
                <HistoryActionButton disabled={!history.length} onClick={toggleHistorySorted} className={cn(sorted && "bg-black/5 dark:bg-white/10")} style={{ color: theme.node.text }} aria-pressed={sorted} label="排序" icon={<ArrowDownWideNarrow className="size-3.5" />} description={sorted ? "排序：当前先按末尾数字编号，再按名称排列；点击恢复生成任务请求顺序" : "排序：先按末尾 -1、-2 等数字编号排列，同一编号再按名称排列"} />
                <HistoryActionButton disabled={retrying || !failed.length} onClick={() => void retryTargets(failed)} className="guan-history-retry-all" style={{ color: theme.node.text }} aria-busy={retrying} label={retrying ? "正在重试…" : "重试"} icon={<RotateCcw className="size-3.5" />} description={retrying ? "正在重试失败任务" : "重试：只重试失败任务，不重新生成成功任务"} />
                <HistoryActionButton disabled={downloading || (!selectionMode && !validCompletedFiles.length)} onClick={toggleSelectionMode} className="guan-history-select" style={{ color: theme.node.text }} aria-pressed={selectionMode} label={selectionMode ? "取消" : "选择"} icon={<ListChecks className="size-3.5" />} description={selectionMode ? "取消列表勾选模式" : "选择：勾选要下载的卡片"} />
                <HistoryActionButton disabled={downloading || !validCompletedFiles.length || (selectionMode && !selectedHistoryFiles.length)} onClick={() => void downloadAll(selectionMode ? selectedHistoryFiles : validCompletedFiles)} className={cn("guan-download-action", downloading && "is-loading")} style={{ color: theme.node.text }} aria-busy={downloading} label={downloading ? "正在打包…" : "下载"} icon={<Download className="guan-download-icon size-3.5" />} description={downloading ? "正在打包下载文件" : !validCompletedFiles.length ? "下载：暂无可下载的成功文件" : selectionMode ? "下载：打包下载勾选的文件" : "下载：打包下载全部已成功生成的文件"} />
                <HistoryActionButton onClick={() => { beginOverviewSelection(); setOverviewOpen(true); }} style={{ color: theme.node.text }} label="总览" icon={<LayoutGrid className="size-3.5" />} description="总览：勾选并对照查看生成图片详情" />
                </div>
            </div>
                {history.length ? (
                    <HistoryVirtualList items={displayedHistory} getKey={historyNodeKey} estimateSize={72} gap={6} paddingX={12} paddingY={6}
                        label="生成历史列表" className="guan-scroll-region guan-apple-scroll min-h-0 flex-1" resetKey={sorted} offsetRef={historyOffset}>
                        {(node) => {
                            const info = historyMediaInfo(node, config.channels);
                            const details = [info.channel, decodeChannelModel(info.model)?.model || info.model, info.dimensions, formatBytes(info.bytes) || "大小未知", info.format].join(" · ");
                            const invalidFiles = filesByNode.get(node.id)?.invalid || [];
                            const invalid = invalidFiles.length > 0;
                            const nodeFailed = failedByNode.get(node.id) || [];
                            const nodeRetryTargets = [...nodeFailed, ...invalidFiles.filter(file => !nodeFailed.some(target => target.imageId === file.imageId)
                                && !imageSizeRetryBlocked(file.imageId ? node.metadata?.images?.find(image => image.id === file.imageId) : node.metadata)).map(file => ({ node, imageId: file.imageId, unavailableStorageKey: file.storageKey }))];
                            const nodeFiles = filesByNode.get(node.id)?.valid || [];
                            const busy = node.metadata?.status === "loading" || node.metadata?.images?.some(image => image.status === "loading");
                            return (
                            <motion.div key={node.id} layout={displayedHistory.length <= 80 ? "position" : false} layoutDependency={sorted} transition={{ layout: { type: "spring", bounce: 0, duration: .28 } }} onClick={event => { if (selectionMode && event.target instanceof Element && !event.target.closest("button,input,label")) toggleHistorySelection(node.id); }} className={cn("guan-history-list-card flex w-full flex-wrap items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/10", selectionMode && nodeFiles.some(file => selectedHistoryIds.has(file.id)) && "bg-black/5 dark:bg-white/10")}>
                                <AnimatePresence initial={false}>{selectionMode ? <SelectionInline key="selection">
                                    <Checkbox aria-label={`勾选${node.title || "生成任务"}`} disabled={downloading || !nodeFiles.length} checked={nodeFiles.length > 0 && nodeFiles.every(file => selectedHistoryIds.has(file.id))} indeterminate={nodeFiles.some(file => selectedHistoryIds.has(file.id)) && !nodeFiles.every(file => selectedHistoryIds.has(file.id))} onChange={() => toggleHistorySelection(node.id)} />
                                </SelectionInline> : null}</AnimatePresence>
                                <button type="button" disabled={!nodeFiles.length} onClick={() => onPreviewNode(node.id)} className="shrink-0 disabled:cursor-default disabled:opacity-50" aria-label={nodeFiles.length ? `预览${node.title || "生成任务"}` : `${node.title || "生成任务"}暂无成功图片`}>
                                {node.type === CanvasNodeType.Image && (node.metadata?.content || node.metadata?.images?.find((image) => image.content)?.content) ? (
                                    <MediaThumbnail storageKey={node.metadata.storageKey || node.metadata.images?.find(image => image.content)?.storageKey} fallback={node.metadata.content || node.metadata.images?.find(image => image.content)?.content} className="size-10 shrink-0 rounded-md object-cover guan-image-shared-element" style={{ viewTransitionName: `guan-history-${node.id}` }} />
                                ) : (
                                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-black/5 dark:bg-white/10">
                                        {node.type === CanvasNodeType.Video ? <Video className="size-4 opacity-60" /> : <ImageIcon className="size-4 opacity-60" />}
                                    </span>
                                )}
                                </button>
                                <button type="button" disabled={downloading || (!selectionMode && !nodeFiles.length)} onClick={() => selectionMode ? toggleHistorySelection(node.id) : onPreviewNode(node.id)} className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left" aria-label={selectionMode ? `选择${node.title || "生成任务"}` : nodeFiles.length ? `查看${node.title || "生成任务"}的成功图片` : `${node.title || "生成任务"}暂无成功图片`}>
                                <span className="size-2 shrink-0 rounded-full" style={{ background: invalid ? STATUS_COLOR.error : STATUS_COLOR[node.metadata?.status || "idle"] || STATUS_COLOR.idle }} />
                                <span className="min-w-0 flex-1 break-words">
                                    <span className="font-medium">{node.title || (node.type === CanvasNodeType.Video ? "生成视频" : "生成图片")}</span>
                                    <span className="guan-history-media-info ml-2 break-words text-[10px] leading-relaxed opacity-55" title={invalid ? "媒体缓存不可用" : details}>{invalid ? "媒体缓存不可用" : details}</span>
                                </span>
                                <AnimatePresence initial={false}>{!selectionMode && nodeFiles.length ?
                                    <SelectionInline key="view" width={24}>
                                        <span className="whitespace-nowrap opacity-55">查看</span>
                                    </SelectionInline> : null}</AnimatePresence>
                                </button>
                                {nodeRetryTargets.length ? (
                                    <button type="button" disabled={retrying || busy} onClick={() => void retryTargets(nodeRetryTargets)} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-medium text-red-500 transition hover:bg-red-500/10 disabled:opacity-40" title="重试" aria-label={`重试${node.title || "生成任务"}`}>
                                        <RotateCcw className="size-3.5" />
                                        <span>重试</span>
                                    </button>
                                ) : null}
                            </motion.div>
                            );
                        }}
                    </HistoryVirtualList>
                ) : <div className="min-h-0 flex-1 overflow-y-auto"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无生成历史" className="pt-16" /></div>}
            <AnimatePresence initial={false}>{selectionMode ? (
                <SelectionFooter key="selection-footer">
                <div className="guan-history-selection-footer flex items-center gap-3 border-t px-3 py-3 text-xs" style={{ borderColor: theme.node.stroke }}>
                    <Checkbox disabled={downloading || !validCompletedFiles.length} checked={validCompletedFiles.length > 0 && selectedHistoryCount === validCompletedFiles.length} indeterminate={selectedHistoryCount > 0 && selectedHistoryCount < validCompletedFiles.length} onChange={event => selectFiles(validCompletedFiles.map(file => file.id), event.target.checked)}>全选</Checkbox>
                    <span className="opacity-55" role="status" aria-live="polite">已选 {selectedHistoryCount} 个文件</span>
                    <HistoryActionButton disabled={downloading || !selectedHistoryFiles.length} onClick={() => void downloadAll(selectedHistoryFiles)} aria-busy={downloading} label={downloading ? "正在打包…" : "下载选中"} icon={<Download className="size-3.5" />} description="打包下载已勾选的成功文件" />
                </div>
                </SelectionFooter>
            ) : null}</AnimatePresence>
            <AnimatePresence>{overviewOpen ? <HistoryOverviewPanel key="history-overview" history={displayedHistory} files={validCompletedFiles} selectedFiles={selectedHistoryFiles} selectedIds={selectedHistoryIds} channels={config.channels} sorted={sorted} downloading={downloading} theme={theme} onSelect={selectFiles} onDownload={file => void downloadFile(file)} onDownloadSelected={() => void downloadAll(selectedHistoryFiles)} onToggleSort={toggleHistorySorted} onClose={() => { setOverviewOpen(false); endOverviewSelection(); }} /> : null}</AnimatePresence>
        </div>
    );
});

