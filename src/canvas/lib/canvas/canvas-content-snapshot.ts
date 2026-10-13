import type { CanvasNodeData } from "@/types/canvas";

const positionIndependentTypes = new Set(["text", "image", "video", "audio", "config", "group"]);

// Resource lists and prompt panels do not depend on card coordinates. Retain
// their input identities during movement, but invalidate on every other field.
export function canvasContentSnapshot(previous: CanvasNodeData[], nodes: CanvasNodeData[]) {
    if (previous.length !== nodes.length) return nodes;
    for (let index = 0; index < nodes.length; index++) {
        const before = previous[index];
        const next = nodes[index];
        if (before === next) continue;
        const keys = new Set([...Object.keys(before), ...Object.keys(next)]);
        for (const key of keys) {
            // Third-party resource callbacks may inspect coordinates. Never
            // assume a plugin follows the built-in resource contract.
            if (key === "position" && positionIndependentTypes.has(next.type)) continue;
            if (before[key as keyof CanvasNodeData] !== next[key as keyof CanvasNodeData]) return nodes;
        }
    }
    return previous;
}
