// 同配置结果横排、单线并排与重叠避让共用原历史；整理不改变当前视区。
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { CanvasNodeType, type ViewportTransform } from "@/types/canvas";
import { layoutCanvas } from "./画布整体排布";
import type { CanvasHistoryPort, CanvasHistorySnapshot } from "../扩展边界/画布历史接口";

type ArrangementPort<T extends CanvasHistorySnapshot> = Pick<CanvasHistoryPort<T>, "historyRef" | "createHistoryEntry" | "applyHistory" | "message"> & {
    size: { width: number; height: number };
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
};

export function useCanvasNodeArrangement<T extends CanvasHistorySnapshot>({ historyRef, createHistoryEntry, applyHistory, message, setSelectedNodeIds }: ArrangementPort<T>) {
    return useCallback((selectedIds?: ReadonlySet<string>) => {
        const before = createHistoryEntry();
        const arranged = layoutCanvas(before.nodes, before.connections, selectedIds);
        if (arranged === before.nodes) {
            message.info("没有需要整理的卡片");
            return;
        }
        const moved = arranged.filter((node, index) => node.type !== CanvasNodeType.Group && node.position !== before.nodes[index].position).length;
        historyRef.current.past = [...historyRef.current.past.slice(-49), before];
        historyRef.current.future = [];
        applyHistory({ ...before, nodes: arranged });
        if (selectedIds) setSelectedNodeIds(new Set(selectedIds));
        message.success(`已整理 ${moved} 张卡片，可点击撤销恢复`);
    }, [applyHistory, createHistoryEntry, historyRef, message, setSelectedNodeIds]);
}
