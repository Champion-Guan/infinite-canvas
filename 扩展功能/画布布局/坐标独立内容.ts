import type { CanvasNodeData } from "@/types/canvas";

const positionIndependentTypes = new Set(["text", "image", "video", "audio", "config", "group", "guan:prompt-variables"]);

// 旧版内容快照：只忽略内置卡片的坐标，其余字段及未知插件变化均使内容失效。
export function canvasContentSnapshot(previous: CanvasNodeData[], nodes: CanvasNodeData[]) {
    if (previous.length !== nodes.length) return nodes;
    for (let index = 0; index < nodes.length; index++) {
        const before = previous[index], next = nodes[index];
        if (before === next) continue;
        for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
            if (key === "position" && positionIndependentTypes.has(next.type)) continue;
            if (before[key as keyof CanvasNodeData] !== next[key as keyof CanvasNodeData]) return nodes;
        }
    }
    return previous;
}
