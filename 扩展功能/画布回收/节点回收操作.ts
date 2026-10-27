// 节点批次恢复、素材存在门禁、永久移除及历史清理的单一边界。
import { useCallback, useRef, type RefObject } from "react";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { collectImageStorageKeys, getImageBlob } from "@/services/image-storage";
import { collectMediaStorageKeys, getMediaBlob } from "@/services/file-storage";
import { hydrateCanvasImages, resetInterruptedGeneration, hasResumableVideoTask } from "@/lib/canvas/canvas-generation-helpers";
import type { CanvasNodeData } from "@/types/canvas";
import { restoreCanvasNodes, withoutDeletedNodes } from "./画布节点回收";
import { observeActivity } from "../安全与批量/update-activity";
import { settleActivityGroup } from "../安全与批量/settle-activity-group";
import { saveProductCanvas } from "../产品/产品操作";
import type { CanvasHistoryPort, CanvasHistorySnapshot } from "../扩展边界/画布历史接口";

type RecyclePort<T extends CanvasHistorySnapshot> = CanvasHistoryPort<T> & {
    lastHistoryRef: RefObject<T | null>;
    updateProject: ReturnType<typeof useCanvasStore.getState>["updateProject"];
    cleanupCanvasFiles: (extra?: unknown) => void;
    pollVideoNodeTask: (node: CanvasNodeData, resume: boolean) => unknown;
};
export function useCanvasNodeRecycle<T extends CanvasHistorySnapshot>({ projectId, nodesRef, historyRef, lastHistoryRef, createHistoryEntry, applyHistory, setSelectedNodeIds, assertImportTarget, message, updateProject, cleanupCanvasFiles, pollVideoNodeTask }: RecyclePort<T>) {
    const recycleBusyRef = useRef(new Set<string>());
    const restoreDeletedNodeBatch = useCallback(async (batchId: string) => {
        if (recycleBusyRef.current.has(batchId)) return;
        recycleBusyRef.current.add(batchId);
        let applied = false;
        try {
            await observeActivity("storage", async () => {
                assertImportTarget();
                const batch = useCanvasStore.getState().openProject(projectId)?.deletedNodeBatches?.find(item => item.id === batchId);
                if (!batch) return;
                const candidates = batch.nodes.filter(node => !nodesRef.current.some(current => current.id === node.id));
                await settleActivityGroup([
                    ...[...collectImageStorageKeys(candidates)].map(async key => { if (!await getImageBlob(key)) throw new Error("图片素材缺失，已保留回收批次，请恢复素材后重试。"); }),
                    ...[...collectMediaStorageKeys(candidates)].filter(key => !key.startsWith("image:")).map(async key => { if (!await getMediaBlob(key)) throw new Error("音视频素材缺失，已保留回收批次，请恢复素材后重试。"); }),
                ]);
                const hydrated = await hydrateCanvasImages(resetInterruptedGeneration(candidates));
                assertImportTarget();
                const stored = useCanvasStore.getState().openProject(projectId)!;
                if (stored.deletedNodeBatches?.find(item => item.id === batchId) !== batch) throw new Error("回收批次已变化，请重试恢复。");
                const before = createHistoryEntry();
                const result = restoreCanvasNodes(before.nodes, before.connections, { ...batch, nodes: hydrated });
                historyRef.current.past = [...historyRef.current.past.slice(-49), before];
                historyRef.current.future = [];
                applyHistory({ ...before, nodes: result.nodes, connections: result.connections });
                updateProject(projectId, { nodes: result.nodes, connections: result.connections, deletedNodeBatches: (stored.deletedNodeBatches || []).filter(item => item.id !== batchId) });
                applied = true;
                setSelectedNodeIds(new Set(result.restoredIds));
                await saveProductCanvas(projectId);
                result.nodes.filter(node => result.restoredIds.includes(node.id) && hasResumableVideoTask(node)).forEach(node => void pollVideoNodeTask(node, true));
                message.success(`已恢复 ${result.restoredIds.length} 个节点`);
            });
        } catch (error) {
            message.error(`${applied ? "节点已恢复，但保存未确认：" : "恢复失败："}${error instanceof Error ? error.message : String(error)}`);
        } finally { recycleBusyRef.current.delete(batchId); }
    }, [applyHistory, assertImportTarget, createHistoryEntry, message, pollVideoNodeTask, projectId, updateProject, historyRef, nodesRef, setSelectedNodeIds]);

    const permanentlyDeleteNodeBatch = useCallback(async (batchId: string) => {
        if (recycleBusyRef.current.has(batchId)) return;
        recycleBusyRef.current.add(batchId);
        let applied = false;
        try {
            assertImportTarget();
            const stored = useCanvasStore.getState().openProject(projectId)!;
            const batch = stored.deletedNodeBatches?.find(item => item.id === batchId);
            if (!batch) return;
            const active = new Set(nodesRef.current.map(node => node.id));
            const removed = new Set(batch.nodes.filter(node => !active.has(node.id)).map(node => node.id));
            historyRef.current.past = historyRef.current.past.map(entry => withoutDeletedNodes(entry, removed));
            historyRef.current.future = historyRef.current.future.map(entry => withoutDeletedNodes(entry, removed));
            if (lastHistoryRef.current) lastHistoryRef.current = withoutDeletedNodes(lastHistoryRef.current, removed);
            const remaining = stored.deletedNodeBatches!.filter(item => item.id !== batchId).map(item => ({ ...withoutDeletedNodes(item, removed), relatedNodes: withoutDeletedNodes({ nodes: item.relatedNodes || [], connections: [] }, removed).nodes }));
            updateProject(projectId, { deletedNodeBatches: remaining });
            applied = true;
            await saveProductCanvas(projectId);
            cleanupCanvasFiles({ deletedNodeBatches: remaining });
            message.success("已永久移除这批节点的恢复记录");
        } catch (error) {
            message.error(`${applied ? "记录已移除，但保存未确认：" : "永久删除失败："}${error instanceof Error ? error.message : String(error)}`);
        } finally { recycleBusyRef.current.delete(batchId); }
    }, [assertImportTarget, cleanupCanvasFiles, message, projectId, updateProject, historyRef, lastHistoryRef, nodesRef]);

    return { restoreDeletedNodeBatch, permanentlyDeleteNodeBatch };
}
