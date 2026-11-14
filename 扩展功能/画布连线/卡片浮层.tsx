import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import type { CanvasNodeData } from "@/types/canvas";
import { useProductActive } from "../产品/产品界面边界";
import { CANVAS_FLOATING_CHANGE, CANVAS_PANEL_REVEAL, placeCanvasPanel, readCanvasFloatingBounds } from "../画布交互/浮层可见区域";
import { APPLE_POPOVER_TRANSITION } from "../主题/苹果动效";

export function CardPanelLayer({ node, target, children }: { node: CanvasNodeData; target?: HTMLDivElement | null; children: ReactNode }) {
    const active = useProductActive(), panel = useRef<HTMLDivElement>(null);
    const present = useIsPresent(), reduced = useReducedMotion();
    const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden", left: 0, top: 0, width: 600 });
    const [side, setSide] = useState("bottom");
    useLayoutEffect(() => {
        if (!target || !active || !present) return;
        let frame = 0;
        let geometry = "";
        let revealed = false;
        const source = target.closest('.guan-canvas-viewport')?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`);
        const sync = () => {
            frame = 0;
            const element = panel.current;
            if (!element || !source) return;
            const bounds = readCanvasFloatingBounds(source);
            const rect = source.getBoundingClientRect();
            const toolbar = source.closest('[data-product-id]')?.querySelector(`[data-node-toolbar="${CSS.escape(node.id)}"]`)?.getBoundingClientRect();
            const anchor = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
            const nextGeometry = [anchor.left, anchor.top, anchor.right, anchor.bottom, toolbar?.left, toolbar?.top, toolbar?.right, toolbar?.bottom, bounds.left, bounds.top, bounds.right, bounds.bottom, element.scrollHeight, element.clientWidth].join(":");
            if (geometry === nextGeometry && element.contains(document.activeElement)) return;
            geometry = nextGeometry;
            const placement = placeCanvasPanel(anchor, { width: 600, height: element.scrollHeight }, bounds, toolbar);
            if ((placement.width < 320 || placement.height < Math.min(element.scrollHeight, 300)) && !revealed) {
                revealed = true;
                source.dispatchEvent(new CustomEvent(CANVAS_PANEL_REVEAL, { bubbles: true, detail: {
                    node: { position: { x: node.position.x, y: node.position.y }, width: node.width, height: node.height }, bounds } }));
                return;
            }
            setSide(placement.side);
            setStyle(previous => {
                const next = { left: placement.left, top: placement.top, width: placement.width,
                    maxHeight: placement.height, "--canvas-panel-max-height": `${placement.height}px`, visibility: "visible" as const };
                return Object.keys(next).every(key => previous[key as keyof CSSProperties] === next[key as keyof typeof next]) ? previous : next;
            });
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
        const observer = new ResizeObserver(schedule);
        if (panel.current) observer.observe(panel.current);
        if (source) observer.observe(source);
        window.addEventListener("resize", schedule); window.addEventListener(CANVAS_FLOATING_CHANGE, schedule);
        window.visualViewport?.addEventListener("resize", schedule);
        sync();
        return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", schedule);
            window.removeEventListener(CANVAS_FLOATING_CHANGE, schedule); window.visualViewport?.removeEventListener("resize", schedule); };
    }, [active, present, target, node.id, node.position.x, node.position.y, node.width, node.height]);
    if (!target) return children;
    if (!active) return null;
    return createPortal(
        <div ref={panel} data-card-panel-anchor={node.id} data-card-panel-state={present ? "open" : "closing"}
            data-canvas-floating-side={side} data-canvas-no-zoom aria-hidden={!present} inert={!present}
            onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} className="fixed z-[1100]" style={{ ...style, pointerEvents: present ? "auto" : "none", overflowY: "auto", overscrollBehavior: "contain", borderRadius: 16,
            }}>
            <motion.div initial={{ opacity: 0, scale: reduced ? 1 : .98 }} animate={{ opacity: style.visibility === "visible" ? 1 : 0, scale: 1 }}
                exit={{ opacity: 0, scale: reduced ? 1 : .98 }} transition={reduced ? { duration: 0 } : APPLE_POPOVER_TRANSITION}
                style={{ transformOrigin: side === "right" ? "left center" : side === "left" ? "right center" : side === "top" ? "center bottom" : "center top" }}>
            {children}
            </motion.div>
        </div>, document.body,
    );
}
