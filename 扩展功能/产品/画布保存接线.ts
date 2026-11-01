// 复用产品提交票据、当前节点事务与SQLite队列，不另建保存状态。
import { useEffect, useMemo, type RefObject } from "react";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useProductCanvasSave } from "./产品操作";
import { flushSQLiteStorage } from "../本机存储/上游浏览器存储桥";
import { canvasHasPendingChanges, retainCanvasReferences } from "./画布保存判定";
import { isBatchCanvasSaveActive, markBatchCanvasDirty } from "../画布生成/批量保存协调";

type CanvasSavePort = {
    projectId: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    projectLoaded: boolean;
    restoredProjectIdRef: RefObject<string | null>;
    nodeTransactionRef: RefObject<CanvasNodeData[]>;
    historyPausedRef: RefObject<boolean>;
    dragRef: RefObject<{ isDraggingNode: boolean }>;
    isNodeDragging: boolean;
    isNodeResizing: boolean;
    isCanvasPanning?: boolean;
    canvasPanningRef?: RefObject<boolean>;
    nodeResizingRef?: RefObject<boolean>;
    focusAnimRef: RefObject<number | null>;
    viewportRef: RefObject<ViewportTransform>;
    viewportSaveTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
    generationRequestsRef: RefObject<ReadonlyMap<string, unknown>>;
    runningNodeId: string | null;
    updateProject: ReturnType<typeof useCanvasStore.getState>["updateProject"];
};

export function useCanvasPersistence({ projectId, nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo, viewport, projectLoaded, restoredProjectIdRef, nodeTransactionRef, historyPausedRef, dragRef, isNodeDragging, isNodeResizing, isCanvasPanning = false, canvasPanningRef, nodeResizingRef, focusAnimRef, viewportRef, viewportSaveTimerRef, generationRequestsRef, runningNodeId, updateProject }: CanvasSavePort) {
    useEffect(() => {
        if (!projectLoaded || restoredProjectIdRef.current !== projectId || historyPausedRef.current
            || isNodeDragging || isNodeResizing || isCanvasPanning || dragRef.current.isDraggingNode
            || nodeResizingRef?.current || canvasPanningRef?.current || focusAnimRef.current !== null) return;
        const current = useCanvasStore.getState().projects.find(project => project.id === projectId);
        const patch = { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo };
        // 选择、悬浮、同值回放和结束空手势均不进入全画布序列化。
        if (!canvasHasPendingChanges(current, patch)) return;
        if (isBatchCanvasSaveActive(projectId)) {
            markBatchCanvasDirty(projectId);
            return;
        }
        // 手势结束后将最终卡片和最终视区一并提交，避免再拆成两次保存。
        updateProject(projectId, retainCanvasReferences(current, { ...patch, viewport: viewportRef.current }));
    }, [activeChatId, backgroundMode, chatSessions, connections, nodes, projectId, projectLoaded, showImageInfo, updateProject, isNodeDragging, isNodeResizing, isCanvasPanning, historyPausedRef, dragRef, nodeResizingRef, canvasPanningRef, focusAnimRef, restoredProjectIdRef, viewport, viewportRef]);

    const snapshot = useMemo(() => ({ projectId, nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo, viewport }),
        [projectId, nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo, viewport]);
    useProductCanvasSave(projectId, snapshot,
        () => projectLoaded && restoredProjectIdRef.current === projectId && !historyPausedRef.current && nodes === nodeTransactionRef.current
            && !dragRef.current.isDraggingNode && !isNodeDragging && !isNodeResizing && !isCanvasPanning
            && !nodeResizingRef?.current && !canvasPanningRef?.current && focusAnimRef.current === null,
        async (committed, options) => {
            const { projectId: id, ...patch } = committed;
            if (restoredProjectIdRef.current !== id || committed.nodes !== nodeTransactionRef.current) throw new Error("Canvas commit invalidated");
            if (!useCanvasStore.getState().projects.some(project => project.id === id)) throw new Error("Canvas unavailable");
            updateProject(id, retainCanvasReferences(useCanvasStore.getState().projects.find(project => project.id === id), patch));
            if (!options?.deferSQLiteFlush) await flushSQLiteStorage();
            // 完整快照实际保存后才取消同一视区的延迟写入；保留更新视区的计时器。
            if (viewportRef.current === committed.viewport) {
                if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
                viewportSaveTimerRef.current = null;
            }
        }, () => generationRequestsRef.current.size === 0 && runningNodeId === null);

    useEffect(() => {
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = null;
        if (!projectLoaded || isNodeDragging || isNodeResizing || isCanvasPanning
            || dragRef.current.isDraggingNode || historyPausedRef.current || nodeResizingRef?.current
            || canvasPanningRef?.current || focusAnimRef.current !== null) return;
        const current = useCanvasStore.getState().projects.find(project => project.id === projectId);
        if (!canvasHasPendingChanges(current, { viewport: viewportRef.current })) return;
        const timer = setTimeout(() => {
            if (viewportSaveTimerRef.current !== timer) return;
            viewportSaveTimerRef.current = null;
            // 开始新手势的同步ref先于React渲染生效；按住不动也不能触发旧计时器保存。
            if (restoredProjectIdRef.current !== projectId || dragRef.current.isDraggingNode
                || historyPausedRef.current || nodeResizingRef?.current || canvasPanningRef?.current
                || focusAnimRef.current !== null) return;
            // 一键执行全部生成时，节点结果与视区变化共用同一份最终快照。
            // 视区延迟写入不能绕过批量保存门控，否则仍会在任务执行中触发整画布SQLite保存。
            if (isBatchCanvasSaveActive(projectId)) {
                markBatchCanvasDirty(projectId);
                return;
            }
            const latest = useCanvasStore.getState().projects.find(project => project.id === projectId);
            if (!canvasHasPendingChanges(latest, { viewport: viewportRef.current })) return;
            updateProject(projectId, retainCanvasReferences(latest, { viewport: viewportRef.current }));
        }, 2000);
        viewportSaveTimerRef.current = timer;
        return () => {
            clearTimeout(timer);
            if (viewportSaveTimerRef.current === timer) viewportSaveTimerRef.current = null;
        };
    }, [projectId, projectLoaded, updateProject, viewport, viewportRef, viewportSaveTimerRef, isNodeDragging, isNodeResizing, isCanvasPanning, dragRef, historyPausedRef, nodeResizingRef, canvasPanningRef, focusAnimRef, restoredProjectIdRef]);

    useEffect(() => {
        const commitPendingViewport = (event?: BeforeUnloadEvent) => {
            if (!projectLoaded || restoredProjectIdRef.current !== projectId || historyPausedRef.current
                || isNodeDragging || isNodeResizing || isCanvasPanning || dragRef.current.isDraggingNode
                || nodeResizingRef?.current || canvasPanningRef?.current || focusAnimRef.current !== null) return;
            const current = useCanvasStore.getState().projects.find(project => project.id === projectId);
            if (!current || !canvasHasPendingChanges(current, { viewport: viewportRef.current })) return;
            // 退出前必须等待SQLite回执，浏览器不能保证卸载后的异步请求继续执行。
            if (event) { event.preventDefault(); event.returnValue = ""; }
            if (isBatchCanvasSaveActive(projectId)) {
                markBatchCanvasDirty(projectId);
                return;
            }
            updateProject(projectId, retainCanvasReferences(current, { viewport: viewportRef.current }));
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
            viewportSaveTimerRef.current = null;
            // 写入失败保留在SQLite恢复队列，由既有保存状态条显示并重试。
            void flushSQLiteStorage().catch(() => {});
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") commitPendingViewport();
        };
        window.addEventListener("beforeunload", commitPendingViewport);
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            window.removeEventListener("beforeunload", commitPendingViewport);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [projectId, projectLoaded, updateProject, isNodeDragging, isNodeResizing, isCanvasPanning,
        restoredProjectIdRef, historyPausedRef, dragRef, nodeResizingRef, canvasPanningRef,
        focusAnimRef, viewportRef, viewportSaveTimerRef]);
}
