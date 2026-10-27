// 同配置结果横排、单线并排与重叠避让共用原历史和视区；没有位置变化时不写入。
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { CanvasNodeType, type ViewportTransform } from "@/types/canvas";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { arrangeOverlappingCanvasNodes } from "./卡片自动避让";
import { arrangeConfigResultRows } from "./配置结果横排";
import type { CanvasHistoryPort, CanvasHistorySnapshot } from "../扩展边界/画布历史接口";

type ArrangementPort<T extends CanvasHistorySnapshot> = Pick<CanvasHistoryPort<T>, "historyRef" | "createHistoryEntry" | "applyHistory" | "message"> & {
    size: { width: number; height: number };
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
};

export function useCanvasNodeArrangement<T extends CanvasHistorySnapshot>({ historyRef, createHistoryEntry, applyHistory, message, size, setViewport }: ArrangementPort<T>) {
    return useCallback(() => {
        const before = createHistoryEntry();
        const arranged = arrangeOverlappingCanvasNodes(arrangeConfigResultRows(before.nodes, before.connections), before.connections);
        if (arranged === before.nodes) {
            message.info("没有需要整理的卡片");
            return;
        }
        const moved = arranged.filter((node, index) => node.type !== CanvasNodeType.Group && node.position !== before.nodes[index].position).length;
        historyRef.current.past = [...historyRef.current.past.slice(-49), before];
        historyRef.current.future = [];
        applyHistory({ ...before, nodes: arranged });
        const visibleNodes = arranged.filter(node => node.type !== CanvasNodeType.Group && Number.isFinite(node.position.x) && Number.isFinite(node.position.y) && Number.isFinite(node.width) && Number.isFinite(node.height));
        if (visibleNodes.length) {
            const bounds = nodeBounds(visibleNodes);
            const availableWidth = Math.max(100, size.width - 64);
            const availableHeight = Math.max(100, size.height - 180);
            const k = Math.max(0.05, Math.min(1, availableWidth / Math.max(1, bounds.right - bounds.left), availableHeight / Math.max(1, bounds.bottom - bounds.top)));
            setViewport({ x: 32 + availableWidth / 2 - (bounds.left + bounds.right) / 2 * k, y: 64 + availableHeight / 2 - (bounds.top + bounds.bottom) / 2 * k, k });
        }
        message.success(`已整理 ${moved} 张卡片，可点击撤销恢复`);
    }, [applyHistory, createHistoryEntry, historyRef, message, size.width, size.height, setViewport]);
}
