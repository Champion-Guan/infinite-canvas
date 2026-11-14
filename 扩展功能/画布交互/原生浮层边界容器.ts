import { useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { CANVAS_FLOATING_CHANGE, readCanvasFloatingBounds } from "./浮层可见区域";

const containers = new WeakMap<HTMLElement, HTMLDivElement>();
export function toolbarPopupTargetOffset(anchor: HTMLElement | null, placement = ""): [number, number] | undefined {
    const dock = anchor?.closest("[data-canvas-bottom-toolbar],.guan-canvas-zoom-dock");
    if (!anchor || !dock || !placement.startsWith("top")) return undefined;
    return [0, Math.max(0, anchor.getBoundingClientRect().top - dock.getBoundingClientRect().top) + 4];
}
export const NATIVE_POPUP_LIMIT: CSSProperties = {
    maxWidth: "100%", minWidth: 0, maxHeight: "100%", overflowY: "auto", overscrollBehavior: "contain", pointerEvents: "auto",
};

// 只提供原生定位器的可见区域，不再改写原生浮层的translate或测量动画中的尺寸。
export function useNativePopupBoundary(open: boolean) {
    const source = useRef<HTMLElement | null>(null), container = useRef<HTMLDivElement | null>(null);
    const expanded = useRef(open); expanded.current = open;
    const signature = useRef("");
    const update = useCallback(() => {
        const root = container.current, anchor = source.current;
        if (!root || !anchor) return;
        const bounds = readCanvasFloatingBounds(anchor), rect = anchor.getBoundingClientRect();
        // 工具栏本身位于画布预留区之外；原生定位必须包含锚点，才能正确翻转和避让。
        if (anchor.closest("[data-canvas-bottom-toolbar],.guan-canvas-zoom-dock")) {
            const visual = window.visualViewport;
            bounds.bottom = (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight) - 12;
        }
        bounds.left = Math.min(bounds.left, rect.left - 12);
        bounds.top = Math.min(bounds.top, rect.top - 12);
        const geometry = [bounds.left, bounds.top, bounds.right, bounds.bottom, rect.left, rect.top, rect.right, rect.bottom].join(":");
        if (signature.current === geometry) return;
        signature.current = geometry;
        root.style.left = `${bounds.left}px`; root.style.top = `${bounds.top}px`;
        root.style.width = `${bounds.right - bounds.left}px`; root.style.height = `${bounds.bottom - bounds.top}px`;
        const modal = anchor.closest<HTMLElement>(".ant-modal-wrap");
        root.style.zIndex = modal ? String(Math.max(1300, Number(getComputedStyle(modal).zIndex) + 10)) : "1300";
        root.dispatchEvent(new Event("scroll"));
    }, []);
    const getPopupContainer = useCallback((anchor: HTMLElement) => {
        if (!expanded.current && container.current?.isConnected) return container.current;
        const previous = source.current;
        source.current = anchor;
        const scope = anchor.closest<HTMLElement>('[data-product-id]') ?? anchor.ownerDocument.body;
        const owner = anchor.closest<HTMLElement>("[data-canvas-bottom-toolbar],.guan-canvas-zoom-dock") ?? scope;
        let root = containers.get(owner);
        if (!root?.isConnected) {
            root = anchor.ownerDocument.createElement("div");
            root.dataset.canvasNativePopupBoundary = "true";
            Object.assign(root.style, { position: "fixed", overflow: "hidden", pointerEvents: "none", zIndex: "1300" });
            scope.appendChild(root); containers.set(owner, root);
        }
        if (container.current !== root || previous !== anchor) signature.current = "";
        container.current = root; update();
        return root;
    }, [update]);
    useLayoutEffect(() => {
        if (!open) return;
        let frame = 0;
        const sync = () => { frame = 0; update(); };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
        const observer = new ResizeObserver(schedule);
        if (source.current) observer.observe(source.current);
        window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, true);
        window.addEventListener(CANVAS_FLOATING_CHANGE, schedule);
        window.visualViewport?.addEventListener("resize", schedule); window.visualViewport?.addEventListener("scroll", schedule);
        update();
        return () => {
            cancelAnimationFrame(frame); observer.disconnect();
            window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true);
            window.removeEventListener(CANVAS_FLOATING_CHANGE, schedule);
            window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule);
        };
    }, [open, update]);
    useEffect(() => {
        const root = container.current;
        if (!open || !root?.addEventListener) return;
        const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
        const reveal = (event: Event) => {
            if (!(event.target instanceof HTMLElement) || event.target === root) return;
            const popup = event.target.closest<HTMLElement>(".ant-select-dropdown,.ant-dropdown,.ant-dropdown-menu-submenu-popup");
            if (!popup) return;
            clearTimeout(timers.get(popup));
            popup.dataset.menuScrollActive = "true";
            timers.set(popup, setTimeout(() => { delete popup.dataset.menuScrollActive; timers.delete(popup); }, 700));
        };
        root.addEventListener("scroll", reveal, true);
        return () => {
            root.removeEventListener("scroll", reveal, true);
            for (const [popup, timer] of timers) { clearTimeout(timer); delete popup.dataset.menuScrollActive; }
        };
    }, [open]);
    return getPopupContainer;
}
