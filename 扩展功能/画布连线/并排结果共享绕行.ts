import type { Position } from "@/types/canvas";
import { segmentBlocked, type RoutingBox } from "./卡片避障路由";

type Branch = { id: string; start: Position; end: Position; boxes: readonly RoutingBox[] };
const clear = (points: Position[], boxes: readonly RoutingBox[]) => points.slice(1).every((b, i) => !segmentBlocked(points[i], b, boxes));
const length = (points: Position[]) => points.slice(1).reduce((sum, b, i) => sum + Math.abs(points[i].x - b.x) + Math.abs(points[i].y - b.y), 0);

// 同一排结果统一选择上方或下方通道，不让每条关系各自选最短方向而包围图片。
export function sharedResultDetours(branches: readonly Branch[], rowTop: number, rowBottom: number, preferredSide?: "top" | "bottom") {
    const result = new Map<string, Position[]>();
    if (branches.length < 2) return result;
    const start = branches[0].start;
    const gap = Math.min(...branches.map(b => b.end.x - start.x));
    if (gap <= 0) return result;
    const trunkX = start.x + Math.min(28, gap / 3);
    const blocked = branches.filter(branch => !clear([branch.start, { x: trunkX, y: branch.start.y }, { x: trunkX, y: branch.end.y }, branch.end], branch.boxes));
    if (!blocked.length) return result;
    let best: { paths: Map<string, Position[]>; cost: number; side: "top" | "bottom" } | undefined;
    const candidates: { paths: Map<string, Position[]>; cost: number; side: "top" | "bottom" }[] = [];
    for (const side of ["top", "bottom"] as const) {
        const y = side === "top" ? rowTop - 18 : rowBottom + 18;
        const paths = new Map<string, Position[]>();
        let cost = 0;
        for (const branch of blocked) {
            const targetX = branch.end.x - Math.min(28, (branch.end.x - start.x) / 3);
            const points = [branch.start, { x: trunkX, y: start.y }, { x: trunkX, y }, { x: targetX, y }, { x: targetX, y: branch.end.y }, branch.end];
            if (!clear(points, branch.boxes)) break;
            paths.set(branch.id, points); cost += length(points);
        }
        if (paths.size === blocked.length) {
            const candidate = { paths, cost, side }; candidates.push(candidate);
            if (!best || cost < best.cost) best = candidate;
        }
    }
    // 小幅拖动不因几像素的路径差反复换边；旧侧不安全时立即采用安全路线。
    const preferred = candidates.find(candidate => candidate.side === preferredSide);
    if (best && preferred && preferred.cost <= best.cost + blocked.length * 64) best = preferred;
    return best?.paths ?? result;
}
