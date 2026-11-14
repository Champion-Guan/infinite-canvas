import { useLayoutEffect, useRef } from "react";
import { CANVAS_FLOATING_CHANGE, fitFloatingRect, readCanvasFloatingBounds, type FloatingRect } from "./浮层可见区域";
import { floatingLayoutRect } from "./浮层布局矩形";

// 只定位组件交付的自身面板，不拦截全局Portal，不扫描或改写其他业务窗口。
export function useFloatingBoundary(open: boolean, anchor: () => Element | null, popup: () => HTMLElement | null) {
    const latest = useRef({ anchor, popup }); latest.current = { anchor, popup };
    useLayoutEffect(() => {
        if (!open) return;
        let frame = 0, disposed = false;
        let element: HTMLElement | null = null;
        const owned = ["maxWidth", "minWidth", "maxHeight", "overflowX", "overflowY", "overscrollBehavior", "translate"] as const;
        let original: Partial<Record<typeof owned[number], string>> = {};
        let baseTranslate = ["0px", "0px"];
        let written: Record<string, string> = {}, normalized: Record<string, string> = {};
        const restore = () => { if (element) for (const key of owned) element.style[key] = original[key] ?? ""; };
        let dx = 0, dy = 0;
        let lastStyle = "";
        const observer = new ResizeObserver(() => schedule());
        const alignment = new MutationObserver(() => { if ((element?.getAttribute("style") ?? "") !== lastStyle) schedule(); });
        const sync = () => {
            frame = 0;
            if (disposed) return;
            const node = latest.current.popup();
            if (!node) return;
            if (element !== node) {
                restore();
                element = node; original = Object.fromEntries(owned.map(key => [key, node.style[key]])); dx = 0; dy = 0;
                written = {}; normalized = {};
                const translated = getComputedStyle(node).translate;
                baseTranslate = translated && translated !== "none" ? translated.split(" ") : ["0px", "0px"];
                observer.observe(node);
                alignment.observe(node, { attributes: true, attributeFilter: ["style"] });
            }
            const write = (key: typeof owned[number], value: string) => {
                if (written[key] === value && node.style[key] === normalized[key]) return;
                node.style[key] = value; written[key] = value; normalized[key] = node.style[key];
            };
            const bounds = readCanvasFloatingBounds(latest.current.anchor());
            const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
            const toolbar = node.hasAttribute("data-node-toolbar");
            write("maxWidth", `${width}px`);
            write("minWidth", "0");
            write("maxHeight", `${height}px`);
            write("overflowY", toolbar ? "hidden" : "auto");
            if (toolbar) write("overflowX", "auto");
            write("overscrollBehavior", "contain");
            const { rect: r, parentX, parentY } = floatingLayoutRect(node);
            const base: FloatingRect = { left: r.left - dx * parentX, right: r.right - dx * parentX, top: r.top - dy * parentY, bottom: r.bottom - dy * parentY };
            const fit = fitFloatingRect(base, bounds);
            dx = (fit.left - base.left) / parentX; dy = (fit.top - base.top) / parentY;
            write("translate", `calc(${baseTranslate[0]} + ${dx}px) calc(${baseTranslate[1] || "0px"} + ${dy}px)`);
            node.dataset.canvasFloatingBounded = "true";
            lastStyle = node.getAttribute("style") ?? "";
        };
        const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(sync); };
        const source = latest.current.anchor();
        if (source) observer.observe(source);
        const canvas = source?.closest('[data-product-id]')?.querySelector('.guan-canvas-viewport');
        if (canvas) observer.observe(canvas);
        window.addEventListener("resize", schedule);
        window.addEventListener("scroll", schedule, true);
        window.addEventListener(CANVAS_FLOATING_CHANGE, schedule);
        window.addEventListener("animationend", schedule, true);
        window.visualViewport?.addEventListener("resize", schedule);
        window.visualViewport?.addEventListener("scroll", schedule);
        sync(); schedule();
        return () => {
            disposed = true; cancelAnimationFrame(frame); observer.disconnect(); alignment.disconnect();
            window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true);
            window.removeEventListener(CANVAS_FLOATING_CHANGE, schedule);
            window.removeEventListener("animationend", schedule, true);
            window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule);
            restore();
            if (element) delete element.dataset.canvasFloatingBounded;
        };
    }, [open]);
}
