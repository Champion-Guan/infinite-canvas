import type { CanvasNodeData } from "@/types/canvas";
import type { ConnectionGeometry } from "./圆角连线路由";

// 吸附会把端口中心设成同一坐标。这里只容忍浮点运算误差，不能把视觉接近当作已吸附。
const alignedPort = (a: number, b: number) => Math.abs(a - b) <= 1e-7;

// 仅允许端口完全同高的同源并排结果共享水平直线，关系仍连接配置与结果。
export function inlineResultOccluders(from: CanvasNodeData, to: CanvasNodeData, siblings: readonly CanvasNodeData[]) {
    const ids = new Set<string>();
    if (from.type !== "config" || to.type !== "image") return ids;
    const y = from.position.y + from.height / 2;
    if (!alignedPort(y, to.position.y + to.height / 2)) return ids;
    for (const node of siblings) {
        if (node.id === to.id || node.type !== "image" || !alignedPort(y, node.position.y + node.height / 2)) continue;
        if (node.position.x >= from.position.x + from.width && node.position.x + node.width <= to.position.x && y > node.position.y && y < node.position.y + node.height) ids.add(node.id);
    }
    return ids;
}

export function obscuredInlineResults(geometry: readonly ConnectionGeometry[], active: ReadonlySet<string>) {
    const ids = new Set<string>();
    // 当前高亮关系的端点都是用户正在查看的内容，不能互相淡化。
    const protectedIds = new Set<string>();
    for (const item of geometry) if (active.has(item.connection.id)) {
        protectedIds.add(item.from.id);
        protectedIds.add(item.to.id);
    }
    for (const item of geometry) {
        if (!active.has(item.connection.id)) continue;
        const siblings = geometry.filter(edge => edge.from.id === item.from.id).map(edge => edge.to);
        for (const id of inlineResultOccluders(item.from, item.to, siblings)) {
            if (protectedIds.has(id)) continue;
            const node = siblings.find(node => node.id === id)!;
            if (item.route.points.slice(1).some((b, index) => {
                const a = item.route.points[index];
                return a.y === b.y && a.y > node.position.y && a.y < node.position.y + node.height && Math.max(a.x, b.x) > node.position.x && Math.min(a.x, b.x) < node.position.x + node.width;
            })) ids.add(id);
        }
    }
    return ids;
}
