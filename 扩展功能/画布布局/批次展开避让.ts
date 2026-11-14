import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";
type Box = { left: number; top: number; right: number; bottom: number };
type Offset = { x: number; y: number };
const gap = 24;
const overlaps = (a: Box, b: Box) => a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
const translate = (box: Box, delta: Offset): Box => ({ left: box.left + delta.x, right: box.right + delta.x, top: box.top + delta.y, bottom: box.bottom + delta.y });
const union = (boxes: Box[]): Box => ({ left: Math.min(...boxes.map(b => b.left)), top: Math.min(...boxes.map(b => b.top)),
    right: Math.max(...boxes.map(b => b.right)), bottom: Math.max(...boxes.map(b => b.bottom)) });

export function batchExpansionBox(node: CanvasNodeData, expanded: boolean): Box {
    const count = expanded ? node.type === "image" ? node.metadata?.images?.length ?? 1 : node.type === "text" ? node.metadata?.texts?.length ?? 1 : 1 : 1;
    const columns = Math.min(Math.max(count, 1), 4), rows = Math.ceil(Math.max(count, 1) / columns);
    return { left: node.position.x, top: node.position.y - (rows - 1) * (node.height + 18),
        right: node.position.x + columns * node.width + (columns - 1) * 18, bottom: node.position.y + node.height };
}

function nearestVacancy(box: Box, obstacles: Box[]) {
    if (!obstacles.some(other => overlaps(box, other))) return { x: 0, y: 0 };
    const width = box.right - box.left, height = box.bottom - box.top;
    const candidates = obstacles.flatMap(other => [
        { x: other.right + gap - box.left, y: 0 }, { x: other.left - gap - width - box.left, y: 0 },
        { x: 0, y: other.bottom + gap - box.top }, { x: 0, y: other.top - gap - height - box.top },
    ]).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    return candidates.find(delta => !obstacles.some(other => overlaps(translate(box, delta), other)))!;
}

export function batchExpansionOffsets(nodes: CanvasNodeData[], expanded: ReadonlySet<string>) {
    const result = new Map<string, Offset>();
    if (!expanded.size) return result;
    const byId = new Map(nodes.map(node => [node.id, node]));
    const expandedGroups = new Set(nodes.filter(node => expanded.has(node.id)).map(node => node.metadata?.groupId).filter(Boolean));
    const units = new Map<string, { ids: string[]; box: Box; expanded: boolean }>();
    for (const node of nodes) {
        // 批次所在组内部也需避让；其余组作为整体移动，组容器随后按显示子卡重算。
        if (node.type === "group" && expandedGroups.has(node.id)) continue;
        const groupId = node.metadata?.groupId;
        const key = groupId && byId.has(groupId) && !expandedGroups.has(groupId) ? groupId : node.id;
        const previous = units.get(key), box = batchExpansionBox(node, expanded.has(node.id));
        units.set(key, { ids: [...previous?.ids ?? [], node.id], box: previous ? union([previous.box, box]) : box,
            expanded: Boolean(previous?.expanded || expanded.has(node.id)) });
    }
    const ordered = [...units.entries()].sort((a, b) => Number(b[1].expanded) - Number(a[1].expanded));
    const occupied = new Map(ordered.map(([id, unit]) => [id, unit.box]));
    const reserved: Box[] = [];
    for (const [id, unit] of ordered) {
        if (!unit.expanded && !reserved.some(box => overlaps(unit.box, box))) continue;
        const obstacles = unit.expanded ? reserved : [...occupied].filter(([key]) => key !== id).map(([, box]) => box);
        const delta = nearestVacancy(unit.box, obstacles);
        const box = translate(unit.box, delta);
        occupied.set(id, box); reserved.push(box);
        if (delta.x || delta.y) unit.ids.forEach(key => result.set(key, delta));
    }
    return result;
}

export function displayBatchNodes(nodes: CanvasNodeData[], offsets: ReadonlyMap<string, Offset>) {
    if (!offsets.size) return nodes;
    const moved = nodes.map(node => {
        const offset = offsets.get(node.id);
        return offset ? { ...node, position: { x: node.position.x + offset.x, y: node.position.y + offset.y } } : node;
    });
    return moved.map(node => {
        if (node.type !== "group") return node;
        const children = moved.filter(child => child.metadata?.groupId === node.id);
        if (!children.some(child => offsets.has(child.id))) return node;
        const bounds = union([batchExpansionBox(node, false), ...children.map(child => batchExpansionBox(child, false))]);
        return { ...node, position: { x: bounds.left, y: bounds.top }, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
    });
}

export function revealBatchExpansion(view: ViewportTransform, box: Box, canvas: Box, safe: Box, root?: Box): ViewportTransform {
    const left = canvas.left + view.x + box.left * view.k, right = canvas.left + view.x + box.right * view.k;
    const top = canvas.top + view.y + box.top * view.k, bottom = canvas.top + view.y + box.bottom * view.k;
    const shift = (start: number, end: number, min: number, max: number) => end - start > max - min ? (min + max - start - end) / 2
        : start < min ? min - start : end > max ? max - end : 0;
    let dx = shift(left, right, safe.left, safe.right), dy = shift(top, bottom, safe.top, safe.bottom);
    if (root) {
        // 超大批次不能为了居中把收起按钮移出屏幕；保留根卡可操作，允许用户继续平移浏览。
        const x = canvas.left + view.x + (root.right - 24) * view.k;
        const y = canvas.top + view.y + (root.top + 24) * view.k;
        dx = Math.max(safe.left + 16 - x, Math.min(dx, safe.right - 16 - x));
        dy = Math.max(safe.top + 16 - y, Math.min(dy, safe.bottom - 16 - y));
    }
    return { ...view, x: view.x + dx, y: view.y + dy };
}
