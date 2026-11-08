import type { CanvasNodeData } from "@/types/canvas";
import { NODE_PLACEMENT_GAP, nodesOverlap } from "./卡片自动避让";

export function placeAlignedGenerationConfig(source: CanvasNodeData, config: CanvasNodeData, occupied: CanvasNodeData[]) {
    let position = { x: source.position.x + source.width + 96,
        y: source.position.y + (source.height - config.height) / 2 };
    const obstacles = occupied.filter(node => node.type !== "group" && node.id !== source.id && node.id !== config.id);
    for (let attempt = 0; attempt <= obstacles.length; attempt++) {
        const hits = obstacles.filter(node => nodesOverlap({ ...config, position }, node, NODE_PLACEMENT_GAP));
        if (!hits.length) break;
        position = { ...position, x: Math.max(...hits.map(node => node.position.x + node.width + NODE_PLACEMENT_GAP)) };
    }
    return { ...config, position };
}
