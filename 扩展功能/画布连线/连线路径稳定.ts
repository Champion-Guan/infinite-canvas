import type { Position } from "@/types/canvas";
import { segmentBlocked, type RoutingBox } from "./卡片避障路由";
const length = (points: readonly Position[]) => points.slice(1).reduce((sum, point, i) => sum + Math.abs(point.x - points[i].x) + Math.abs(point.y - points[i].y), 0);
const verticals = (points: readonly Position[]) => [...new Set(points.slice(1).flatMap((point, i) => point.x === points[i].x && point.y !== points[i].y ? [point.x] : []))];

type SharedTrunkBranch = { start: Position; end: Position; boxes: readonly RoutingBox[]; previous?: readonly Position[] };

// 共享主干按整组保留，不能让一条分支重算后其余分支各自留下旧竖线。
export function retainSafeSharedTrunk(branches: readonly SharedTrunkBranch[], preferred: number) {
    if (branches.length < 2) return preferred;
    const votes = new Map<number, number>();
    for (const branch of branches) {
        const lanes = branch.previous ? verticals(branch.previous) : [];
        if (lanes.length === 1) votes.set(lanes[0], (votes.get(lanes[0]) ?? 0) + 1);
    }
    const candidates = [...votes.keys()].sort((a, b) => votes.get(b)! - votes.get(a)! || Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
    for (const x of candidates) {
        if (branches.every(({ start, end, boxes }) => {
            if (start.y === end.y) return true; // 同高关系保持直连，不约束竖向主干。
            const stub = Math.min(28, (end.x - start.x) / 3);
            if (x < start.x + stub || x > end.x - stub) return false;
            const points = [start, { x, y: start.y }, { x, y: end.y }, end];
            return points.slice(1).every((point, i) => !segmentBlocked(points[i], point, boxes));
        })) return x;
    }
    return preferred;
}

// 调整两端相邻折点以跟随卡片，不缓存数据、不阻止必要的避障重算。
export function retainSafeConnectionRoute(previous: readonly Position[] | undefined, fresh: Position[], boxes: readonly RoutingBox[], coordinated = false) {
    if (!previous || previous.length < 4 || fresh.length <= 2) return fresh;
    const candidate = previous.map(point => ({ ...point }));
    candidate[0] = { ...fresh[0] }; candidate[candidate.length - 1] = { ...fresh[fresh.length - 1] };
    const firstHorizontal = previous[0].y === previous[1].y;
    const lastHorizontal = previous[previous.length - 1].y === previous[previous.length - 2].y;
    if (!firstHorizontal || !lastHorizontal) return fresh;
    candidate[1].y = candidate[0].y; candidate[candidate.length - 2].y = candidate[candidate.length - 1].y;
    if (candidate[1].x <= candidate[0].x || candidate[candidate.length - 2].x >= candidate[candidate.length - 1].x) return fresh;
    const freshLanes = verticals(fresh), oldLanes = verticals(candidate);
    if (coordinated && freshLanes.length === 1 && (oldLanes.length !== 1 || oldLanes[0] !== freshLanes[0])) return fresh;
    if (candidate.some((b, i) => {
        const a = candidate[i - 1], c = candidate[i + 1];
        return a && c && (b.x - a.x) * (c.y - b.y) === (b.y - a.y) * (c.x - b.x)
            && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0;
    })) return fresh;
    if (candidate.length > fresh.length + 2 || length(candidate) > length(fresh) + 48) return fresh;
    if (!candidate.slice(1).every((b, i) => (candidate[i].x === b.x || candidate[i].y === b.y) && !segmentBlocked(candidate[i], b, boxes))) return fresh;
    return candidate;
}
