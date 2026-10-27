import type { Position } from "@/types/canvas";

type Direction = 'left' | 'right' | 'up' | 'down';
type Junction = { point: Position; rays: Map<Direction, number> };
export const junctionPointKey = (point: Position) => `${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}`;

// 同时检查折点和经过折点的长直段，避免支线接在主干中途时漏判。
function junctionDirections(routes: readonly (readonly Position[])[]) {
    const candidates = new Map<string, Junction>();
    type Segment = { a: Position; b: Position };
    const horizontal = new Map<number, Segment[]>(), vertical = new Map<number, Segment[]>();
    for (const points of routes) {
        for (let i = 0; i < points.length; i++) {
            const point = points[i], key = junctionPointKey(point);
            if (!candidates.has(key)) candidates.set(key, { point, rays: new Map() });
            if (i) {
                const a = points[i - 1], b = point;
                const index = a.y === b.y ? horizontal : vertical;
                const axis = Math.round((a.y === b.y ? a.y : a.x) * 1000);
                const list = index.get(axis) ?? [];
                list.push({ a, b }); index.set(axis, list);
            }
        }
    }
    for (const { point, rays } of candidates.values()) {
        const add = (direction: Direction, length: number) => {
            if (length > 0.001) rays.set(direction, Math.max(rays.get(direction) ?? 0, length));
        };
        const segments = [...(horizontal.get(Math.round(point.y * 1000)) ?? []), ...(vertical.get(Math.round(point.x * 1000)) ?? [])];
        for (const { a, b } of segments) {
            if (a.y === b.y && Math.abs(a.y - point.y) < 0.001 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)) {
                add('left', point.x - Math.min(a.x, b.x)); add('right', Math.max(a.x, b.x) - point.x);
            } else if (a.x === b.x && Math.abs(a.x - point.x) < 0.001 && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) {
                add('up', point.y - Math.min(a.y, b.y)); add('down', Math.max(a.y, b.y) - point.y);
            }
        }
    }
    return candidates;
}

export function connectionJunctions(routes: readonly (readonly Position[])[]) {
    return new Set([...junctionDirections(routes)].filter(([, junction]) => junction.rays.size >= 3).map(([key]) => key));
}

// 给连续主干的内侧轮廓添加小圆角填充，而不是把两条大圆弧叠在一起。
// 与线条一同在同一透明度组绘制，避免交点颜色加深；尺寸以屏幕像素固定。
export function softJunctionContours(routes: readonly (readonly Position[])[], topology: readonly (readonly Position[])[], scale: number, lineWidth: number) {
    const junctions = connectionJunctions(topology);
    const zoom = Math.max(scale, 0.05), half = lineWidth / (2 * zoom), desired = 3 / zoom;
    const patches: string[] = [];
    for (const [key, { point, rays }] of junctionDirections(routes)) {
        if (!junctions.has(key)) continue;
        for (const [horizontal, sx] of [['left', -1], ['right', 1]] as const) {
            for (const [vertical, sy] of [['up', -1], ['down', 1]] as const) {
                const h = rays.get(horizontal), v = rays.get(vertical);
                if (!h || !v) continue;
                const radius = Math.min(desired, Math.max(0, h / 2 - half), Math.max(0, v / 2 - half));
                if (!radius) continue;
                const x = point.x + sx * half, y = point.y + sy * half;
                patches.push(`M ${x + sx * radius} ${y} Q ${x} ${y} ${x} ${y + sy * radius} L ${x} ${y} Z`);
            }
        }
    }
    return patches.join(' ');
}

// 只标记实际分叉/汇合处，不把普通转弯或无关系的交叉画成连接点。
export function connectionJunctionDots(routes: readonly (readonly Position[])[], topology: readonly (readonly Position[])[] = routes) {
    const junctions = connectionJunctions(topology);
    return [...junctionDirections(routes)]
        .filter(([key, junction]) => junctions.has(key) && junction.rays.size >= 2)
        .map(([key, junction]) => ({ key, ...junction.point }));
}
