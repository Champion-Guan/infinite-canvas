import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";

export type PortAlignmentGuide = { x1: number; x2: number; y: number };

// 只对正在拖动的卡片吸附，不调整未参与拖动的卡片；多选保持相对位置。
export function snapConnectionPorts(nodes: CanvasNodeData[], connections: readonly CanvasConnection[], moved: ReadonlySet<string>, scale: number) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    let best: { delta: number; movingId: string; top: number; guide: PortAlignmentGuide } | undefined;
    for (const connection of connections) {
        const from = byId.get(connection.fromNodeId), to = byId.get(connection.toNodeId);
        if (!from || !to || moved.has(from.id) === moved.has(to.id)) continue;
        if (from.type === 'group' || to.type === 'group') continue;
        const sourceY = from.position.y + from.height / 2, targetY = to.position.y + to.height / 2;
        const delta = moved.has(from.id) ? targetY - sourceY : sourceY - targetY;
        if (Math.abs(delta) * Math.max(scale, 0.01) > 16 || (best && Math.abs(delta) >= Math.abs(best.delta))) continue;
        const moving = moved.has(from.id) ? from : to;
        const alignedY = moved.has(from.id) ? targetY : sourceY;
        best = { delta, movingId: moving.id, top: alignedY - moving.height / 2, guide: { x1: from.position.x + from.width, x2: to.position.x, y: moved.has(from.id) ? targetY : sourceY } };
    }
    return {
        nodes: best ? nodes.map(node => moved.has(node.id) ? { ...node, position: { ...node.position, y: node.id === best!.movingId ? best!.top : node.position.y + best!.delta } } : node) : nodes,
        guide: best?.guide ?? null,
    };
}
