import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CanvasNodeData } from "@/types/canvas";

// 保持原有卡片下方位置，只将浮层移出卡片的 transform/opacity 层叠上下文。
export function CardPanelLayer({ node, target, children }: { node: CanvasNodeData; target?: HTMLDivElement | null; children: ReactNode }) {
    if (!target) return children;
    return createPortal(
        <div data-card-panel-anchor={node.id} data-canvas-no-zoom onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} className="absolute pointer-events-none" style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)`, width: node.width, height: node.height }}>
            {children}
        </div>, target,
    );
}
