import { retainSafeConnectionRoute, retainSafeSharedTrunk } from "./连线路径稳定";
import { sharedResultDetours } from "./并排结果共享绕行";
import { inlineResultOccluders } from "./并排图片关系透视";
import { connectionJunctions, junctionPointKey } from "./连线交点整理";
import { sharedEntryTrunk } from "./共享入口通道";
import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";
import { connectionDesign } from "./连线视觉设计";
import { connectionSelectionKey } from "./连线关系标识";

export type ConnectionRoutingIndex = {
    sourceIndex: number;
    sourceCount: number;
    targetIndex: number;
    targetCount: number;
};

type ConnectionNode = Pick<CanvasNodeData, "position" | "width" | "height">;
export type ConnectionRoute = {
    d: string;
    points: Position[];
    bounds: { left: number; top: number; right: number; bottom: number };
};

import { avoidCards, segmentBlocked, type RoutingBox } from "./卡片避障路由";

const STUB = 28;
const RADIUS = connectionDesign.cornerRadius;
const REVERSE_GAP = 64;

export type ConnectionGeometry = {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    route: ConnectionRoute;
    bounds: ConnectionRoute["bounds"];
};

export type SharedConnectionSegment = {
    key: string;
    d: string;
    connectionIds: string[];
};

function simplifyPoints(points: Position[]) {
    const result: Position[] = [];
    for (const point of points) {
        const last = result[result.length - 1];
        if (last?.x === point.x && last.y === point.y) continue;
        while (result.length > 1) {
            const first = result[result.length - 2];
            const middle = result[result.length - 1];
            const ax = middle.x - first.x;
            const ay = middle.y - first.y;
            const bx = point.x - middle.x;
            const by = point.y - middle.y;
            // 同方向的直线才合并，保留掉头，避免短距离预览穿过卡片。
            if (ax * by !== ay * bx || ax * bx + ay * by < 0) break;
            result.pop();
        }
        result.push(point);
    }
    return result;
}

function roundedPath(points: Position[]) {
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let index = 1; index < points.length - 1; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const next = points[index + 1];
        const beforeLength = Math.hypot(current.x - previous.x, current.y - previous.y);
        const afterLength = Math.hypot(next.x - current.x, next.y - current.y);
        const radius = Math.min(RADIUS, beforeLength / 2, afterLength / 2);
        const beforeX = current.x - ((current.x - previous.x) / beforeLength) * radius;
        const beforeY = current.y - ((current.y - previous.y) / beforeLength) * radius;
        const afterX = current.x + ((next.x - current.x) / afterLength) * radius;
        const afterY = current.y + ((next.y - current.y) / afterLength) * radius;
        d += ` L ${beforeX} ${beforeY} Q ${current.x} ${current.y} ${afterX} ${afterY}`;
    }
    const last = points[points.length - 1];
    return points.length > 1 ? `${d} L ${last.x} ${last.y}` : d;
}

export function routeConnection(from: ConnectionNode, to: ConnectionNode, routing: Partial<ConnectionRoutingIndex> & { trunkX?: number; reverseTop?: number; obstacles?: readonly RoutingBox[]; detourPoints?: Position[]; previousPoints?: readonly Position[]; coordinatedTrunk?: boolean } = {}): ConnectionRoute {
    const start = { x: from.position.x + from.width, y: from.position.y + from.height / 2 };
    const end = { x: to.position.x, y: to.position.y + to.height / 2 };
    const portLength = end.x > start.x ? Math.min(STUB, (end.x - start.x) / 3) : STUB;
    const sourceX = start.x + portLength;
    const targetX = end.x - portLength;
    let points: Position[];
    const gap = end.x - start.x;
    // 正向间隙再窄也在间隙内连接，不把普通相邻卡片误判为反向关系。
    if (gap > 0) {
        const trunkX = Math.max(start.x + gap * 0.15, Math.min(end.x - gap * 0.15, routing.trunkX ?? (start.x + end.x) / 2));
        points = [start, { x: trunkX, y: start.y }, { x: trunkX, y: end.y }, end];
    } else {
        // 同源反向关系共用上方主干，不再为每一条关系制造平行绕行线。
        const top = routing.reverseTop ?? Math.min(from.position.y, to.position.y) - REVERSE_GAP;
        points = [start, { x: sourceX, y: start.y }, { x: sourceX, y: top },
            { x: targetX, y: top }, { x: targetX, y: end.y }, end];
    }
    let safe = true;
    if (routing.obstacles) {
        const boxes = routing.obstacles;
        const sourcePort = { x: sourceX, y: start.y }, targetPort = { x: targetX, y: end.y };
        const sharedX = end.x > start.x ? Math.max(sourceX, Math.min(targetX, routing.trunkX ?? sourceX)) : sourceX;
        const candidate = start.y === end.y && end.x > start.x ? [start, end]
            : [start, sourcePort, { x: sharedX, y: start.y }, { x: sharedX, y: end.y }, targetPort, end];
        if (end.x > start.x && candidate.slice(1).every((b, i) => !segmentBlocked(candidate[i], b, boxes))) points = candidate;
        else {
            const sharedDetour = routing.detourPoints;
            const middle = sharedDetour && sharedDetour.slice(1).every((b, i) => !segmentBlocked(sharedDetour[i], b, boxes))
                ? sharedDetour.slice(1, -1)
                : avoidCards(sourcePort, targetPort, boxes, routing.trunkX ?? sourceX);
            safe = Boolean(middle) && !segmentBlocked(start, sourcePort, boxes) && !segmentBlocked(targetPort, end, boxes);
            points = middle ? [start, ...middle, end] : [start, end];
        }
    }
    if (safe && routing.obstacles && !routing.detourPoints) points = retainSafeConnectionRoute(routing.previousPoints, points, routing.obstacles, routing.coordinatedTrunk);
    const compact = simplifyPoints(points);
    const xs = compact.map(point => point.x);
    const ys = compact.map(point => point.y);
    return {
        d: safe ? roundedPath(compact) : "", points: compact,
        bounds: { left: Math.min(...xs) - RADIUS, top: Math.min(...ys) - RADIUS, right: Math.max(...xs) + RADIUS, bottom: Math.max(...ys) + RADIUS },
    };
}

export function buildSharedConnectionGeometry(connections: readonly CanvasConnection[], nodes: ReadonlyMap<string, CanvasNodeData>, routingMeta: Map<string, ConnectionRoutingIndex> | undefined = undefined, previous: readonly ConnectionGeometry[] = []): ConnectionGeometry[] {
    const seen = new Set<string>();
    const idCounts = new Map<string, number>();
    for (const connection of connections) idCounts.set(connection.id, (idCounts.get(connection.id) ?? 0) + 1);
    const normalized = connections.map(connection => (idCounts.get(connection.id) ?? 0) > 1 ? { ...connection, id: connectionSelectionKey(connection) } : connection);
    routingMeta = idCounts.size < connections.length || !routingMeta ? buildConnectionRoutingMeta(normalized) : routingMeta;
    const groups = new Map<string, { connection: CanvasConnection; from: CanvasNodeData; to: CanvasNodeData }[]>();
    for (const connection of normalized) {
        const from = nodes.get(connection.fromNodeId), to = nodes.get(connection.toNodeId);
        const pair = `${connection.fromNodeId}\u0000${connection.toNodeId}`;
        if (!from || !to || seen.has(pair)) continue;
        seen.add(pair);
        if (!groups.has(from.id)) groups.set(from.id, []);
        groups.get(from.id)!.push({ connection, from, to });
    }
    // 汇流按目标规划一次，不能让每个来源各自挑选一条相邻竖线。
    // 只组织位于目标左侧的输入，反向输入仍由避障器处理。
    const incoming = new Map<string, CanvasNodeData[]>();
    for (const group of groups.values()) for (const item of group) {
        if (item.from.position.x + item.from.width >= item.to.position.x) continue;
        const sources = incoming.get(item.to.id) ?? [];
        sources.push(item.from);
        incoming.set(item.to.id, sources);
    }
    const allNodes = [...nodes.values()].filter(n => n.type !== "group");
    const previousById = new Map(previous.map(item => [connectionSelectionKey(item.connection), item]));
    const previousPoints = (connection: CanvasConnection) => previousById.get(connectionSelectionKey(connection))?.route.points;
    const entryTrunks = new Map<string, number>();
    for (const [targetId, sources] of incoming) {
        if (sources.length < 2) continue;
        const target = nodes.get(targetId)!;
        const rightmostSource = Math.max(...sources.map(n => n.position.x + n.width));
        const gap = target.position.x - rightmostSource;
        entryTrunks.set(targetId, sharedEntryTrunk(sources, target, allNodes, target.position.x - Math.min(160, gap / 2)));
    }
    // 同一来源的相邻汇流通道也一起协调，避免各目标入口各自规划后出现双轨。
    for (const group of groups.values()) {
        const targets = [...new Set(group.map(item => item.to.id))].filter(id => entryTrunks.has(id));
        const ordered = targets.sort((a, b) => entryTrunks.get(a)! - entryTrunks.get(b)!);
        for (let i = 0; i < ordered.length; i++) {
            const cluster = ordered.slice(i).filter(id => entryTrunks.get(id)! - entryTrunks.get(ordered[i])! <= 64);
            if (cluster.length < 2) continue;
            for (const x of [...new Set(cluster.map(id => entryTrunks.get(id)!))]) {
                if (!cluster.every(id => sharedEntryTrunk(incoming.get(id)!, nodes.get(id)!, allNodes, x) === x)) continue;
                for (const id of cluster) entryTrunks.set(id, x);
                break;
            }
        }
    }
    const geometry: ConnectionGeometry[] = [];
    for (const group of groups.values()) {
        const from = group[0].from, startX = from.position.x + from.width;
        const forward = group.filter(item => item.to.position.x > startX);
        const gap = forward.length ? Math.min(...forward.map(item => item.to.position.x - startX)) : STUB * 4;
        const trunkX = startX + Math.min(160, gap * 0.5);
        const reverse = group.filter(item => item.to.position.x <= startX);
        const reverseTop = Math.min(from.position.y, ...reverse.map(item => item.to.position.y)) - REVERSE_GAP;
        const obstacleMap = new Map(group.map(item => {
            const transparent = inlineResultOccluders(item.from, item.to, group.map(edge => edge.to));
            return [item.connection.id, allNodes.filter(n => !transparent.has(n.id)).map(n => {
                const pad = n.id === item.from.id || n.id === item.to.id ? 0 : 18;
                return { left: n.position.x - pad, right: n.position.x + n.width + pad, top: n.position.y - 18, bottom: n.position.y + n.height + 18 };
            })] as const;
        }));
        const sourceTrunk = retainSafeSharedTrunk(forward.filter(item => !entryTrunks.has(item.to.id)).map(item => ({
            start: { x: startX, y: from.position.y + from.height / 2 },
            end: { x: item.to.position.x, y: item.to.position.y + item.to.height / 2 },
            boxes: obstacleMap.get(item.connection.id)!, previous: previousPoints(item.connection),
        })), trunkX);
        const row = group.filter(item => item.to.type === "image" && item.to.position.x > startX && Math.abs(item.to.position.y + item.to.height / 2 - from.position.y - from.height / 2) < Math.min(from.height, item.to.height) / 2);
        const previousDetour = previous.find(item => item.from.id === from.id && row.some(branch => branch.connection.id === item.connection.id) && item.route.points.length === 6);
        const preferredSide = previousDetour ? (previousDetour.route.points[2].y < previousDetour.route.points[0].y ? "top" : "bottom") : undefined;
        const detours = from.type === "config" && row.length > 1 ? sharedResultDetours(row.map(item => ({ id: item.connection.id, start: { x: startX, y: from.position.y + from.height / 2 }, end: { x: item.to.position.x, y: item.to.position.y + item.to.height / 2 }, boxes: obstacleMap.get(item.connection.id)! })), Math.min(...row.map(item => item.to.position.y)), Math.max(...row.map(item => item.to.position.y + item.to.height)), preferredSide) : new Map<string, Position[]>();
        for (const item of group) {
            const obstacles = obstacleMap.get(item.connection.id)!;
            const route = routeConnection(item.from, item.to, { ...routingMeta.get(item.connection.id), sourceCount: group.length, trunkX: entryTrunks.get(item.to.id) ?? sourceTrunk, reverseTop, obstacles, detourPoints: detours.get(item.connection.id), previousPoints: previousPoints(item.connection), coordinatedTrunk: group.length > 1 || entryTrunks.has(item.to.id) });
            if (!route.d) continue; // 卡片重叠封死端口时不绘制穿卡片的伪路径。
            const connection = item.connection;
            geometry.push({ ...item, connection, route, bounds: route.bounds });
        }
    }
    return geometry;
}

const coordinate = (value: number) => Math.round(value * 1000) / 1000;

// 把每条圆角路线拆成直段和拐角，再对共线重叠部分按覆盖关系求并集。
// 最终灰色网络中的每一小段只绘制一次；透明命中区仍保留原关系ID。
export function mergeSharedConnectionSegments(geometry: readonly ConnectionGeometry[], topology: readonly ConnectionGeometry[] = geometry): SharedConnectionSegment[] {
    const junctions = connectionJunctions(topology.map(item => item.route.points));
    type Line = { start: number; end: number; id: string };
    const lines = new Map<string, { horizontal: boolean; fixed: number; spans: Line[] }>();
    const curves = new Map<string, SharedConnectionSegment>();
    const addLine = (a: Position, b: Position, id: string) => {
        const horizontal = a.y === b.y;
        const fixed = coordinate(horizontal ? a.y : a.x);
        const start = coordinate(Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y));
        const end = coordinate(Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y));
        if (start === end) return;
        const key = `${horizontal ? "H" : "V"}:${fixed}`;
        if (!lines.has(key)) lines.set(key, { horizontal, fixed, spans: [] });
        lines.get(key)!.spans.push({ start, end, id });
    };
    for (const { connection, route } of geometry) {
        const points = route.points;
        let cursor = points[0];
        for (let index = 1; index < points.length - 1; index++) {
            const previous = points[index - 1], current = points[index], next = points[index + 1];
            if (junctions.has(junctionPointKey(current))) {
                addLine(cursor, current, connection.id);
                cursor = current;
                continue;
            }
            const beforeLength = Math.hypot(current.x - previous.x, current.y - previous.y);
            const afterLength = Math.hypot(next.x - current.x, next.y - current.y);
            const radius = Math.min(RADIUS, beforeLength / 2, afterLength / 2);
            const before = { x: current.x - (current.x - previous.x) / beforeLength * radius, y: current.y - (current.y - previous.y) / beforeLength * radius };
            const after = { x: current.x + (next.x - current.x) / afterLength * radius, y: current.y + (next.y - current.y) / afterLength * radius };
            addLine(cursor, before, connection.id);
            const a = `${coordinate(before.x)} ${coordinate(before.y)}`, b = `${coordinate(after.x)} ${coordinate(after.y)}`, control = `${coordinate(current.x)} ${coordinate(current.y)}`;
            const key = `Q:${[a, b].sort().join(";")}:${control}`;
            if (!curves.has(key)) curves.set(key, { key, d: `M ${a} Q ${control} ${b}`, connectionIds: [] });
            const curve = curves.get(key)!;
            if (!curve.connectionIds.includes(connection.id)) curve.connectionIds.push(connection.id);
            cursor = after;
        }
        addLine(cursor, points[points.length - 1], connection.id);
    }
    const result: SharedConnectionSegment[] = [];
    for (const [key, { horizontal, fixed, spans }] of lines) {
        const events = new Map<number, { id: string; delta: number }[]>();
        for (const span of spans) {
            if (!events.has(span.start)) events.set(span.start, []);
            if (!events.has(span.end)) events.set(span.end, []);
            events.get(span.start)!.push({ id: span.id, delta: 1 });
            events.get(span.end)!.push({ id: span.id, delta: -1 });
        }
        const active = new Map<string, number>();
        let previous: number | undefined;
        for (const position of [...events.keys()].sort((a, b) => a - b)) {
            if (previous !== undefined && position > previous && active.size) {
                const start = horizontal ? `${previous} ${fixed}` : `${fixed} ${previous}`;
                const end = horizontal ? `${position} ${fixed}` : `${fixed} ${position}`;
                result.push({ key: `${key}:${previous}:${position}`, d: `M ${start} L ${end}`, connectionIds: [...active.keys()].sort() });
            }
            for (const event of events.get(position)!) {
                const count = (active.get(event.id) ?? 0) + event.delta;
                if (count > 0) active.set(event.id, count); else active.delete(event.id);
            }
            previous = position;
        }
    }
    return [...result, ...curves.values()];
}

export function buildConnectionRoutingMeta(connections: readonly CanvasConnection[]) {
    const sources = new Map<string, CanvasConnection[]>();
    const targets = new Map<string, CanvasConnection[]>();
    const result = new Map<string, ConnectionRoutingIndex>();
    for (const connection of connections) {
        if (!sources.has(connection.fromNodeId)) sources.set(connection.fromNodeId, []);
        if (!targets.has(connection.toNodeId)) targets.set(connection.toNodeId, []);
        sources.get(connection.fromNodeId)!.push(connection);
        targets.get(connection.toNodeId)!.push(connection);
        result.set(connection.id, { sourceIndex: 0, sourceCount: 1, targetIndex: 0, targetCount: 1 });
    }
    // 每组只排序一次；拖动节点不重建分组，避免连接越多重复排序越慢。
    for (const group of sources.values()) {
        group.sort((a, b) => a.id.localeCompare(b.id));
        group.forEach((connection, index) => Object.assign(result.get(connection.id)!, { sourceIndex: index, sourceCount: group.length }));
    }
    for (const group of targets.values()) {
        group.sort((a, b) => a.id.localeCompare(b.id));
        group.forEach((connection, index) => Object.assign(result.get(connection.id)!, { targetIndex: index, targetCount: group.length }));
    }
    return result;
}
