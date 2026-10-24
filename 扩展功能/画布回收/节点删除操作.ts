// 可恢复删除共用原回收规则；集中关闭已删除节点对应的界面状态。
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ContextMenuState } from "@/types/canvas";
import { recycleCanvasNodes } from "./画布节点回收";

type Setter<T> = Dispatch<SetStateAction<T>>;
type NodeDeletionPort = {
    projectId: string;
    nodesRef: RefObject<CanvasNodeData[]>;
    connectionsRef: RefObject<CanvasConnection[]>;
    chatSessions: CanvasAssistantSession[];
    updateProject: ReturnType<typeof useCanvasStore.getState>["updateProject"];
    setNodes: Setter<CanvasNodeData[]>;
    setConnections: Setter<CanvasConnection[]>;
    nodeIdSetters: Setter<string | null>[];
    setSelectedNodeIds: Setter<Set<string>>;
    setSelectedConnectionId: Setter<string | null>;
    setPreviewImageId: Setter<string | null>;
    setExpandedBatchNodeIds: Setter<Set<string>>;
    setContextMenu: Setter<ContextMenuState | null>;
    cleanupCanvasFiles: (extra?: unknown) => void;
};

export function useCanvasNodeDeletion({ projectId, nodesRef, connectionsRef, chatSessions, updateProject, setNodes, setConnections, nodeIdSetters, setSelectedNodeIds, setSelectedConnectionId, setPreviewImageId, setExpandedBatchNodeIds, setContextMenu, cleanupCanvasFiles }: NodeDeletionPort) {
    return useCallback((ids: Set<string>) => {
        if (!ids.size) return;
        const stored = useCanvasStore.getState().openProject(projectId);
        if (!stored) return;
        const result = recycleCanvasNodes(nodesRef.current, connectionsRef.current, ids, stored.deletedNodeBatches || []);
        if (!result) return;
        const { allIds } = result;
        updateProject(projectId, { nodes: result.nodes, connections: result.connections, deletedNodeBatches: result.batches });
        setNodes(result.nodes);
        connectionsRef.current = result.connections;
        setConnections(result.connections);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        nodeIdSetters.forEach(setId => setId(current => current && allIds.has(current) ? null : current));
        setPreviewImageId(null);
        setExpandedBatchNodeIds(current => new Set([...current].filter(nodeId => !allIds.has(nodeId))));
        setContextMenu(current => current?.type === "node" && allIds.has(current.nodeId) ? null : current);
        cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter(node => !allIds.has(node.id)), chatSessions });
    }, [projectId, nodesRef, connectionsRef, chatSessions, updateProject, setNodes, setConnections, nodeIdSetters, setSelectedNodeIds, setSelectedConnectionId, setPreviewImageId, setExpandedBatchNodeIds, setContextMenu, cleanupCanvasFiles]);
}
