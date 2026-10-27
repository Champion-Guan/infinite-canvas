// 复用产品提交票据、当前节点事务与SQLite队列，不另建保存状态。
import { useEffect, useMemo, type RefObject } from "react";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useProductCanvasSave } from "./产品操作";
import { flushSQLiteStorage } from "../本机存储/上游浏览器存储桥";
import { retainCanvasReferences } from "./画布保存判定";

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
    focusAnimRef: RefObject<number | null>;
    viewportRef: RefObject<ViewportTransform>;
    viewportSaveTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
    generationRequestsRef: RefObject<ReadonlyMap<string, unknown>>;
    runningNodeId: string | null;
    updateProject: ReturnType<typeof useCanvasStore.getState>["updateProject"];
};

export function useCanvasPersistence({ projectId, nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo, viewport, projectLoaded, restoredProjectIdRef, nodeTransactionRef, historyPausedRef, dragRef, isNodeDragging, isNodeResizing, focusAnimRef, viewportRef, viewportSaveTimerRef, generationRequestsRef, runningNodeId, updateProject }: CanvasSavePort) {
    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current || isNodeDragging || isNodeResizing) return;
        updateProject(projectId, retainCanvasReferences(useCanvasStore.getState().projects.find(project => project.id === projectId), { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo }));
    }, [activeChatId, backgroundMode, chatSessions, connections, nodes, projectId, projectLoaded, showImageInfo, updateProject, isNodeDragging, isNodeResizing, historyPausedRef]);

    const snapshot = useMemo(() => ({ projectId, nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo, viewport }),
        [projectId, nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo, viewport]);
    useProductCanvasSave(projectId, snapshot,
        () => projectLoaded && restoredProjectIdRef.current === projectId && !historyPausedRef.current && nodes === nodeTransactionRef.current
            && !dragRef.current.isDraggingNode && !isNodeDragging && !isNodeResizing && focusAnimRef.current === null,
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
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, retainCanvasReferences(useCanvasStore.getState().projects.find(project => project.id === projectId), { viewport: viewportRef.current }));
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, updateProject, viewport, viewportRef, viewportSaveTimerRef]);
}
