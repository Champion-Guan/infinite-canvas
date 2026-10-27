import type { CanvasNodeData } from "@/types/canvas";
import { segmentBlocked } from "./卡片避障路由";

// 汇流通道必须同时适用于所有来源，不能等每条线各自避障后才尝试合并。
export function sharedEntryTrunk(sources: readonly CanvasNodeData[], target: CanvasNodeData, nodes: readonly CanvasNodeData[], preferred: number) {
    const left = Math.max(...sources.map(node => node.position.x + node.width));
    const right = target.position.x;
    const candidates = [...new Set([preferred, ...nodes.flatMap(node => [node.position.x - 18, node.position.x + node.width + 18]), left + 28, right - 28])]
        .filter(x => x >= left + Math.min(28, (right - left) / 3) && x <= right - Math.min(28, (right - left) / 3))
        .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
    for (const x of candidates) {
        const clear = sources.every(source => {
            const start = { x: source.position.x + source.width, y: source.position.y + source.height / 2 };
            const end = { x: target.position.x, y: target.position.y + target.height / 2 };
            // 同高直连不应为了汇流引入转弯。
            const points = start.y === end.y ? [start, end] : [start, { x, y: start.y }, { x, y: end.y }, end];
            const boxes = nodes.map(node => {
                const pad = node.id === source.id || node.id === target.id ? 0 : 18;
                return {left:node.position.x-pad,right:node.position.x+node.width+pad,top:node.position.y-18,bottom:node.position.y+node.height+18};
            });
            return points.slice(1).every((point, i) => !segmentBlocked(points[i], point, boxes));
        });
        if (clear) return x;
    }
    return preferred; // 没有共同安全通道时保留逐线避障，绝不强行穿卡片。
}
