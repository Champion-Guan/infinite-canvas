import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { FocusFrame } from "@/lib/canvas/canvas-node-geometry";

export function centerCanvasNodeAtScale(
    node: Pick<CanvasNodeData, "position" | "width" | "height">,
    size: { width: number; height: number },
    frame: FocusFrame = {},
    scale: number,
): ViewportTransform {
    const above = frame.above ?? 0;
    const below = frame.below ?? 0;
    const usableBottom = Math.max(0, size.height - (frame.bottomInset ?? 0));
    const nodeCenterX = node.position.x + node.width / 2;
    const nodeCenterY = node.position.y + node.height / 2;
    const groupHeight = above + node.height * scale + below;
    const slack = usableBottom - groupHeight;
    const groupTop = slack * (below > 0 && slack > 0 ? 0.75 : 0.5);

    return {
        x: size.width / 2 - nodeCenterX * scale,
        y: groupTop + groupHeight / 2 - nodeCenterY * scale - (below - above) / 2,
        k: scale,
    };
}
