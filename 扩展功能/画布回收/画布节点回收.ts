import { nanoid } from "nanoid";
import { clearDeletedExcelRelations, excelDeletionIds } from "../Excel画布/Excel卡片事务";
import type { CanvasDeletedNodeBatch } from "@/stores/canvas/use-canvas-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

const relationKeys = ["groupId", "promptVariableSourceNodeId", "promptVariablePreviewNodeId", "excelPromptBindingNodeId"] as const;
const promptKeys = ["promptVariableRawPrompt", "promptVariableResolvedPrompt", "excelPromptResolved"] as const;

export function withoutDeletedNodes<T extends { nodes: CanvasNodeData[]; connections: CanvasConnection[] }>(entry: T, ids: Set<string>): T {
    return {
        ...entry,
        nodes: entry.nodes.filter(node => !ids.has(node.id)).map(node => {
            const next = clearDeletedExcelRelations(node, ids);
            return next.metadata?.groupId && ids.has(next.metadata.groupId) ? { ...next, metadata: { ...next.metadata, groupId: undefined } } : next;
        }),
        connections: entry.connections.filter(edge => !ids.has(edge.fromNodeId) && !ids.has(edge.toNodeId)),
    };
}

export function recycleCanvasNodes(nodes: CanvasNodeData[], connections: CanvasConnection[], ids: Set<string>, batches: CanvasDeletedNodeBatch[]) {
    const allIds = excelDeletionIds(nodes, ids);
    const deleted = nodes.filter(node => allIds.has(node.id));
    if (!deleted.length) return null;
    const next = withoutDeletedNodes({ nodes, connections }, allIds);
    const remaining = new Map(next.nodes.map(node => [node.id, node]));
    const batch: CanvasDeletedNodeBatch = {
        id: nanoid(), nodes: deleted,
        connections: connections.filter(edge => allIds.has(edge.fromNodeId) || allIds.has(edge.toNodeId)),
        relatedNodes: nodes.filter(node => remaining.has(node.id) && remaining.get(node.id) !== node),
        deletedAt: new Date().toISOString(),
    };
    // 再次删除已恢复的部分节点时，保留旧批次中其余节点。
    const previous = batches.map(item => ({ ...item, nodes: item.nodes.filter(node => !allIds.has(node.id)) })).filter(item => item.nodes.length);
    return { ...next, allIds, batches: [...previous, batch] };
}

export function restoreCanvasNodes(nodes: CanvasNodeData[], connections: CanvasConnection[], batch: CanvasDeletedNodeBatch) {
    const present = new Set(nodes.map(node => node.id));
    const additions = batch.nodes.filter(node => !present.has(node.id));
    const available = new Set([...present, ...additions.map(node => node.id)]);
    const snapshots = new Map((batch.relatedNodes || []).map(node => [node.id, node]));
    const restored = nodes.map(node => {
        const snapshot = snapshots.get(node.id)?.metadata;
        if (!snapshot) return node;
        const patch: Record<string, unknown> = {};
        for (const key of relationKeys) {
            if (key === "promptVariablePreviewNodeId" && node.metadata?.promptVariableSourceNodeId && node.metadata.promptVariableSourceNodeId !== snapshot.promptVariableSourceNodeId) continue;
            const value = snapshot[key];
            if (node.metadata?.[key] === undefined && value && available.has(value)) patch[key] = value;
        }
        for (const key of promptKeys) {
            const relation = key === "excelPromptResolved" ? "excelPromptBindingNodeId" : "promptVariableSourceNodeId";
            const originalId = snapshot[relation];
            const currentId = node.metadata?.[relation] || patch[relation];
            if (originalId && currentId === originalId && available.has(originalId) && (node.metadata?.[key] === undefined || node.metadata[key] === "") && snapshot[key] !== undefined) patch[key] = snapshot[key];
        }
        return Object.keys(patch).length ? { ...node, metadata: { ...node.metadata, ...patch } } : node;
    });
    const edgeIds = new Set(connections.map(edge => edge.id));
    return {
        nodes: [...restored, ...additions],
        connections: [...connections, ...batch.connections.filter(edge => available.has(edge.fromNodeId) && available.has(edge.toNodeId) && !edgeIds.has(edge.id))],
        restoredIds: additions.map(node => node.id),
    };
}
