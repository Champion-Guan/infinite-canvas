import { CANVAS_FLOATING_CHANGE, readCanvasFloatingBounds } from "./浮层可见区域";
import { settingsPopoverPosition } from "./设置浮层位置";

// 外壳只负责定位，内容只做透明度动画；测量不依赖动画中的视觉矩形。
export function positionSettingsPanel(panel: HTMLElement, content: HTMLElement, anchor: HTMLElement, placement: string) {
    let frame = 0, disposed = false;
    const write = (key: "width" | "left" | "top" | "maxHeight" | "visibility", value: string) => {
        if (panel.style[key] !== value) panel.style[key] = value;
    };
    const sync = () => {
        frame = 0;
        if (disposed) return;
        const bounds = readCanvasFloatingBounds(anchor);
        const heightBeforeResize = content.offsetHeight;
        const source = anchor.getBoundingClientRect();
        const next = settingsPopoverPosition({ left: source.left - bounds.left, right: source.right - bounds.left,
            top: source.top - bounds.top, bottom: source.bottom - bounds.top, width: source.width }, placement,
            { width: bounds.right - bounds.left, height: bounds.bottom - bounds.top });
        write("width", `${next.width}px`);
        const height = Math.min(content.offsetHeight || heightBeforeResize, next.maxHeight);
        write("left", `${bounds.left + next.left}px`);
        write("top", `${bounds.top + ("top" in next ? next.top! : bounds.bottom - bounds.top - next.bottom! - height)}px`);
        write("maxHeight", `${next.maxHeight}px`); write("visibility", "visible");
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(sync); };
    const scroll = (event: Event) => {
        if (event.target instanceof Node && panel.contains(event.target)) return;
        schedule();
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(content); observer.observe(anchor);
    const canvas = anchor.closest('[data-product-id]')?.querySelector('.guan-canvas-viewport');
    if (canvas) observer.observe(canvas);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener(CANVAS_FLOATING_CHANGE, schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    sync();
    return () => {
        disposed = true; cancelAnimationFrame(frame); observer.disconnect();
        window.removeEventListener("resize", schedule); window.removeEventListener("scroll", scroll, true);
        window.removeEventListener(CANVAS_FLOATING_CHANGE, schedule);
        window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule);
    };
}
