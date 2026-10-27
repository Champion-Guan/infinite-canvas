import { placeCanvasNode, type PlacementBounds } from "../画布布局/卡片自动避让";
import type { CanvasNodeData } from "@/types/canvas";

export function placeAssetNode(node: CanvasNodeData, previous: CanvasNodeData[], bounds?: PlacementBounds) {
    if (!bounds) return placeCanvasNode(node, previous);
    const candidate = { ...node, position: {
        x: Math.max(bounds.x, Math.min(node.position.x, bounds.x + Math.max(0, bounds.width - node.width))),
        y: Math.max(bounds.y, Math.min(node.position.y, bounds.y + Math.max(0, bounds.height - node.height))),
    } };
    return placeCanvasNode(candidate, previous, bounds);
}
