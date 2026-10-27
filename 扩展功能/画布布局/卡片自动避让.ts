import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";

export const NODE_PLACEMENT_GAP = 48;
export type PlacementBounds = { x: number; y: number; width: number; height: number };

export function nextGenerationResultPosition(source: Pick<CanvasNodeData, "position" | "width" | "height">,
    result: Pick<CanvasNodeData, "width" | "height">, existingOutputCount: number, gap = NODE_PLACEMENT_GAP, sourceGap = 96): Position {
    const index = Number.isSafeInteger(existingOutputCount) && existingOutputCount > 0 ? existingOutputCount : 0;
    return { x: source.position.x + source.width + sourceGap + index * (result.width + gap),
        y: source.position.y + (source.height - result.height) / 2 };
}

function valid(node: CanvasNodeData) {
    return Number.isFinite(node.position.x) && Number.isFinite(node.position.y) && Number.isFinite(node.width) && Number.isFinite(node.height) && node.width > 0 && node.height > 0;
}

export function nodesOverlap(a: CanvasNodeData, b: CanvasNodeData, gap = 0) {
    return valid(a) && valid(b) && a.position.x < b.position.x + b.width + gap && a.position.x + a.width + gap > b.position.x && a.position.y < b.position.y + b.height + gap && a.position.y + a.height + gap > b.position.y;
}

/** Positions here are top-left canvas coordinates, independent of browser zoom. */
export function placeCanvasNode(node: CanvasNodeData, occupied: CanvasNodeData[], bounds?: PlacementBounds): CanvasNodeData {
    if (node.type === "group" || !valid(node)) return node;
    // Group backgrounds are containers, not cards. Their children remain obstacles.
    const obstacles = occupied.filter((other) => other.id !== node.id && other.type !== "group" && valid(other));
    const free = (position: Position) => !obstacles.some((other) => nodesOverlap({ ...node, position }, other, NODE_PLACEMENT_GAP));
    const inside = (position: Position) => !bounds || (position.x >= bounds.x && position.y >= bounds.y && position.x + node.width <= bounds.x + bounds.width && position.y + node.height <= bounds.y + bounds.height);
    if (free(node.position) && inside(node.position)) return node;
    if (bounds) {
        // Try the closest visible grid slots first. Bound the search even on huge canvases.
        const candidates: Position[] = [];
        const stepX = node.width + NODE_PLACEMENT_GAP;
        const stepY = node.height + NODE_PLACEMENT_GAP;
        for (let row = -8; row <= 8; row++) for (let col = -8; col <= 8; col++) {
            candidates.push({ x: node.position.x + col * stepX, y: node.position.y + row * stepY });
        }
        candidates.push({ x: bounds.x, y: bounds.y });
        for (const other of obstacles) {
            candidates.push({ x: other.position.x + other.width + NODE_PLACEMENT_GAP, y: node.position.y });
            candidates.push({ x: node.position.x, y: other.position.y + other.height + NODE_PLACEMENT_GAP });
        }
        candidates.sort((a, b) => Math.hypot(a.x - node.position.x, a.y - node.position.y) - Math.hypot(b.x - node.position.x, b.y - node.position.y));
        const position = candidates.find((candidate) => inside(candidate) && free(candidate));
        if (position) return { ...node, position };
    }
    // Automatic results retain their source column and flow downward around occupied rows.
    let position = { ...node.position };
    for (let attempt = 0; attempt <= obstacles.length; attempt++) {
        const hits = obstacles.filter((other) => nodesOverlap({ ...node, position }, other, NODE_PLACEMENT_GAP));
        if (!hits.length) return position.x === node.position.x && position.y === node.position.y ? node : { ...node, position };
        position = { x: position.x, y: Math.max(...hits.map((other) => other.position.y + other.height + NODE_PLACEMENT_GAP)) };
    }
    return { ...node, position };
}

function expandChangedGroups(nodes: CanvasNodeData[], moved: Set<string>) {
    const groups = new Set(nodes.filter((node) => moved.has(node.id)).map((node) => node.metadata?.groupId).filter(Boolean));
    return nodes.map((group) => {
        if (group.type !== "group" || !groups.has(group.id)) return group;
        const children = nodes.filter((node) => node.metadata?.groupId === group.id && valid(node));
        if (!children.length) return group;
        const x = Math.min(group.position.x, ...children.map((node) => node.position.x - 24));
        const y = Math.min(group.position.y, ...children.map((node) => node.position.y - 48));
        const right = Math.max(group.position.x + group.width, ...children.map((node) => node.position.x + node.width + 24));
        const bottom = Math.max(group.position.y + group.height, ...children.map((node) => node.position.y + node.height + 24));
        return x === group.position.x && y === group.position.y && right === group.position.x + group.width && bottom === group.position.y + group.height ? group : { ...group, position: { x, y }, width: right - x, height: bottom - y };
    });
}

/** One state transaction reserves every new card, including concurrent/batch additions. */
export function placeNewCanvasNodes(previous: CanvasNodeData[], next: CanvasNodeData[]) {
    const previousById = new Map(previous.map((node) => [node.id, node]));
    const needsPlacement = (node: CanvasNodeData) => {
        const old = previousById.get(node.id);
        if (!old) return true;
        // Generated media can grow when the real dimensions arrive. Do not
        // treat manual resize/drag/config edits as an automatic layout request.
        return Boolean(node.metadata?.generationStartedAt && (node.width !== old.width || node.height !== old.height) && (node.metadata?.content !== old.metadata?.content || node.metadata?.status !== old.metadata?.status));
    };
    const candidates = new Set(next.filter(needsPlacement).map((node) => node.id));
    if (!candidates.size) return next;
    const occupied = next.filter((node) => !candidates.has(node.id));
    const moved = new Set<string>();
    const result = next.map((node) => {
        if (!candidates.has(node.id)) return node;
        // 整批结果已共同预留列，不能逐卡向下避让而打散与配置卡的对齐。
        if (node.metadata?.generationBatchId && (previousById.has(node.id) || (node.metadata.status === "loading" && node.metadata.generationStartedAt))) { occupied.push(node); return node; }
        const placed = placeCanvasNode(node, occupied);
        occupied.push(placed);
        if (placed !== node) moved.add(node.id);
        return placed;
    });
    return moved.size ? expandChangedGroups(result, moved) : next;
}

function connectionPorts(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const incoming = new Map<string, CanvasConnection[]>();
    const outgoing = new Map<string, CanvasConnection[]>();
    const validConnections = connections.filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId));
    for (const edge of validConnections) {
        incoming.set(edge.toNodeId, [...(incoming.get(edge.toNodeId) ?? []), edge]);
        outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge]);
    }
    // 只锁定实际分支/汇入的端口及其直接关系；配置左侧汇入不影响右侧单线结果。
    const fixed = new Set<string>();
    for (const [id, edges] of incoming) if (edges.length > 1) {
        fixed.add(id);
        for (const edge of edges) fixed.add(edge.fromNodeId);
    }
    for (const [id, edges] of outgoing) if (edges.length > 1) {
        fixed.add(id);
        for (const edge of edges) fixed.add(edge.toNodeId);
    }
    // 上游卡片先整理，避免依赖 connections 数组顺序；闭环不参与自动排布。
    const pending = new Map(nodes.map((node) => [node.id, incoming.get(node.id)?.length ?? 0]));
    const queue = nodes.filter((node) => !pending.get(node.id)).map((node) => node.id);
    const ordered: CanvasConnection[] = [];
    for (let index = 0; index < queue.length; index++) for (const edge of outgoing.get(queue[index]) ?? []) {
        ordered.push(edge);
        pending.set(edge.toNodeId, pending.get(edge.toNodeId)! - 1);
        if (!pending.get(edge.toNodeId)) queue.push(edge.toNodeId);
    }
    for (const [id, count] of pending) if (count) fixed.add(id);
    return { incoming, outgoing, fixed, ordered };
}

function alignSingleConnectionCards(nodes: CanvasNodeData[], ports: ReturnType<typeof connectionPorts>) {
    const result = [...nodes];
    for (const connection of ports.ordered) {
        if (ports.outgoing.get(connection.fromNodeId)?.length !== 1 || ports.incoming.get(connection.toNodeId)?.length !== 1) continue;
        if (ports.fixed.has(connection.toNodeId)) continue;
        const sourceIndex = result.findIndex((node) => node.id === connection.fromNodeId);
        const targetIndex = result.findIndex((node) => node.id === connection.toNodeId);
        if (sourceIndex < 0 || targetIndex < 0) continue;
        const source = result[sourceIndex];
        const target = result[targetIndex];
        if (source.type === "group" || target.type === "group" || !valid(source) || !valid(target)) continue;
        const routeBlockers = result.filter((node) => node.id !== source.id && node.id !== target.id && node.type !== "group" && valid(node));
        const routeIsClear = (from: CanvasNodeData, to: CanvasNodeData) => {
            const centerY = from.position.y + from.height / 2;
            return to.position.x > from.position.x + from.width
                && Math.abs(centerY - (to.position.y + to.height / 2)) <= 1e-7
                && !routeBlockers.some((node) => node.position.x < to.position.x && node.position.x + node.width > from.position.x + from.width
                    && centerY > node.position.y && centerY < node.position.y + node.height);
        };
        // 已经通畅直连的不收紧距离，也不移动来源卡影响它的其他输入关系。
        if (routeIsClear(source, target)) continue;
        const position = { x: source.position.x + source.width + NODE_PLACEMENT_GAP,
            y: source.position.y + (source.height - target.height) / 2 };
        const candidate = { ...target, position };
        if (routeBlockers.some((node) => nodesOverlap(candidate, node, NODE_PLACEMENT_GAP)) || !routeIsClear(source, candidate)) continue;
        result[targetIndex] = candidate;
    }
    if (!result.some((node, index) => node !== nodes[index])) return nodes;
    const moved = new Set(result.filter((node, index) => node.position !== nodes[index].position).map((node) => node.id));
    return expandChangedGroups(result, moved);
}

/** 保留重叠避让；只整理两端端口均为单线的关系，分支/汇入卡片不移动。 */
export function arrangeOverlappingCanvasNodes(nodes: CanvasNodeData[], connections: CanvasConnection[] = []) {
    const ports = connectionPorts(nodes, connections);
    // Reserve branch/merge nodes and their direct neighbors before placing any
    // ordinary card, regardless of input array order.
    const kept: CanvasNodeData[] = nodes.filter((node) => node.type !== "group" && ports.fixed.has(node.id));
    const victims = new Set<string>();
    for (const node of nodes) {
        if (node.type === "group" || ports.fixed.has(node.id)) continue;
        if (kept.some((other) => nodesOverlap(node, other))) victims.add(node.id);
        else kept.push(node);
    }
    let result = nodes;
    if (victims.size) {
        result = nodes.map((node) => {
            if (!victims.has(node.id)) return node;
            const placed = placeCanvasNode(node, kept);
            kept.push(placed);
            return placed;
        });
        result = expandChangedGroups(result, victims);
    }
    return alignSingleConnectionCards(result, ports);
}
