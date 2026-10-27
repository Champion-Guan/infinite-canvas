import type { CanvasNodeData, Position } from "@/types/canvas";
import { NODE_PLACEMENT_GAP, nodesOverlap } from "./卡片自动避让";

export type BatchResultSlot = { source: CanvasNodeData; width: number; height: number };
export type BatchResultPlacement = { batchId: string; columnX: number; centerY: number };

function validBox(node: Pick<CanvasNodeData, "position" | "width" | "height">) {
    return Boolean(node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
        && Number.isFinite(node.width) && node.width > 0 && Number.isFinite(node.height) && node.height > 0);
}

// 整批只计算一次共用列；任一行有障碍，所有结果一起右移。视频预留最终尺寸。
export function planBatchResultColumn(slots: BatchResultSlot[], occupied: CanvasNodeData[], batchId: string) {
    const placements = new Map<string, BatchResultPlacement>();
    if (!slots.length) return placements;
    if (slots.some(slot => !validBox(slot.source) || !validBox({ position: slot.source.position, width: slot.width, height: slot.height }))) {
        throw new Error("生成配置卡片的位置或尺寸无效，请先整理画布");
    }
    const obstacles = occupied.filter(node => node.type !== "group" && validBox(node));
    let x = Math.max(...slots.map(({ source }) => source.position.x + source.width)) + NODE_PLACEMENT_GAP;
    for (let attempt = 0; attempt <= obstacles.length; attempt++) {
        const hits = new Set<CanvasNodeData>();
        for (const slot of slots) {
            const candidate = { ...slot.source, width: slot.width, height: slot.height,
                position: { x, y: slot.source.position.y + (slot.source.height - slot.height) / 2 } };
            for (const obstacle of obstacles) if (nodesOverlap(candidate, obstacle, NODE_PLACEMENT_GAP)) hits.add(obstacle);
        }
        if (!hits.size) break;
        x = Math.max(...[...hits].map(node => node.position.x + node.width + NODE_PLACEMENT_GAP));
    }
    for (const { source } of slots) placements.set(source.id, { batchId, columnX: x, centerY: source.position.y + source.height / 2 });
    return placements;
}

export function batchResultPosition(placement: BatchResultPlacement, size: { height: number }): Position {
    return { x: placement.columnX, y: placement.centerY - size.height / 2 };
}

// 完成、重试及媒体尺寸变化保留批次左边线，手动拖动后也不拉回旧位置。
export function resizedResultPosition(node: CanvasNodeData, size: { width: number; height: number }): Position {
    return { x: node.metadata?.generationBatchId ? node.position.x : node.position.x + (node.width - size.width) / 2,
        y: node.position.y + (node.height - size.height) / 2 };
}
