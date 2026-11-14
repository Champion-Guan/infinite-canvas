import { CANVAS_FLOATING_CHANGE, readCanvasFloatingBounds, type FloatingRect } from "./浮层可见区域";

export function placeReferencePreview(anchor: FloatingRect, bounds: FloatingRect, captionHeight: (width: number) => number = () => 16, aspectRatio = 1) {
    const gap = 8, padding = 24;
    const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
    const widthFactor = Math.min(1, ratio), heightFactor = Math.min(1, 1 / ratio);
    const spaces = [
        { ...bounds, bottom: Math.min(bounds.bottom, anchor.top - gap), side: "top" },
        { ...bounds, top: Math.max(bounds.top, anchor.bottom + gap), side: "bottom" },
        { ...bounds, left: Math.max(bounds.left, anchor.right + gap), side: "right" },
        { ...bounds, right: Math.min(bounds.right, anchor.left - gap), side: "left" },
    ].map(space => {
        let edge = Math.max(0, Math.min(224, (space.right - space.left - padding) / widthFactor));
        for (let pass = 0; pass < 2; pass++)
            edge = Math.max(0, Math.min(edge, (space.bottom - space.top - padding - 4 - captionHeight(edge * widthFactor)) / heightFactor));
        return { ...space, edge, mediaWidth: edge * widthFactor, mediaHeight: edge * heightFactor,
            height: edge * heightFactor + padding + 4 + captionHeight(edge * widthFactor) };
    });
    const space = spaces.find(item => item.edge >= 224) ?? spaces.reduce((best, item) => item.edge > best.edge ? item : best);
    const width = space.mediaWidth + padding, height = space.height;
    const x = space.side === "right" ? space.left : space.side === "left" ? space.right - width : (anchor.left + anchor.right - width) / 2;
    const y = space.side === "top" ? space.bottom - height : space.side === "bottom" ? space.top : anchor.top;
    return { edge: space.edge, mediaWidth: space.mediaWidth, mediaHeight: space.mediaHeight, width, height, side: space.side,
        left: Math.max(bounds.left, Math.min(x, bounds.right - width)),
        top: Math.max(bounds.top, Math.min(y, bounds.bottom - height)) };
}

export function positionReferencePreview(panel: HTMLElement, anchor: HTMLElement) {
    let frame = 0;
    const sync = () => {
        frame = 0;
        const rect = anchor.getBoundingClientRect();
        const media = panel.querySelector<HTMLImageElement>("img");
        const content = panel.querySelector<HTMLElement>("[data-image-reference-preview]");
        const ratio = media?.naturalWidth && media.naturalHeight ? media.naturalWidth / media.naturalHeight
            : Number(content?.dataset?.imageWidth) / Number(content?.dataset?.imageHeight);
        const next = placeReferencePreview(rect, readCanvasFloatingBounds(anchor), width => {
            panel.style.width = `${width + 24}px`;
            return panel.querySelector<HTMLElement>("[data-reference-preview-caption]")?.offsetHeight ?? 16;
        }, ratio);
        Object.assign(panel.style, { left: `${next.left}px`, top: `${next.top}px`, width: `${next.width}px`, height: `${next.height}px`,
            visibility: next.edge > 0 ? "visible" : "hidden" });
        panel.style.setProperty("--reference-preview-edge", `${next.edge}px`);
        panel.style.setProperty("--reference-preview-width", `${next.mediaWidth}px`);
        panel.style.setProperty("--reference-preview-height", `${next.mediaHeight}px`);
        panel.dataset.previewSide = next.side;
        const arrow = panel.querySelector<HTMLElement>("[data-reference-preview-arrow]");
        if (arrow) {
            const x = Math.max(16, Math.min((rect.left + rect.right) / 2 - next.left, next.width - 16));
            const y = Math.max(16, Math.min((rect.top + rect.bottom) / 2 - next.top, next.height - 16));
            Object.assign(arrow.style, {
                left: `${next.side === "right" ? -12 : next.side === "left" ? next.width : x - 6}px`,
                top: `${next.side === "top" ? next.height : next.side === "bottom" ? -12 : y - 6}px`,
                borderTopColor: next.side === "top" ? "var(--reference-preview-background)" : "transparent",
                borderBottomColor: next.side === "bottom" ? "var(--reference-preview-background)" : "transparent",
                borderLeftColor: next.side === "left" ? "var(--reference-preview-background)" : "transparent",
                borderRightColor: next.side === "right" ? "var(--reference-preview-background)" : "transparent",
            });
        }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    const observer = new ResizeObserver(schedule); observer.observe(anchor);
    panel.addEventListener("load", schedule, true);
    const caption = panel.querySelector("[data-reference-preview-caption]");
    if (caption) observer.observe(caption);
    window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, true);
    window.addEventListener(CANVAS_FLOATING_CHANGE, schedule);
    window.visualViewport?.addEventListener("resize", schedule); window.visualViewport?.addEventListener("scroll", schedule);
    sync();
    return () => {
        cancelAnimationFrame(frame); observer.disconnect();
        panel.removeEventListener("load", schedule, true);
        window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true);
        window.removeEventListener(CANVAS_FLOATING_CHANGE, schedule);
        window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule);
    };
}
