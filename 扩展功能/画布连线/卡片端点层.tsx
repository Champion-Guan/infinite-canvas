import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CanvasNodeData } from "@/types/canvas";

// 卡片本体仍可进入透视层，交互端点独立盖在线条上方，不能整张卡片一起提层。
export function CardEndpointLayer({ node, target, children }: { node: CanvasNodeData; target?: HTMLDivElement | null; children: ReactNode }) {
    if (!target) return children;
    // Portal 的物理 DOM 已不在 data-node-id 内。先截断 pointerdown，避免画布
    // 把端点识别成背景并捕获指针；不 preventDefault，保留随后 mousedown 启动连线。
    return createPortal(<div data-card-endpoint-layer={node.id} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} className="absolute pointer-events-none" style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)`, width: node.width, height: node.height }}>{children}</div>, target);
}
