import { useCallback, useEffect, useRef } from "react";
import type { ViewportTransform } from "@/types/canvas";
import type { CanvasViewportController } from "@/components/canvas/infinite-canvas";
import { restoreValidViewport } from "./有效视区";

export function useCanvasScaleGesture(viewport: React.RefObject<ViewportTransform>,
    controller: React.RefObject<CanvasViewportController | null>, size: { width: number; height: number }, stop: () => void) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (timer.current) { clearTimeout(timer.current); controller.current?.finish(); }
    }, [controller]);
    return useCallback((value: number) => {
        if (!controller.current || !Number.isFinite(value)) return;
        if (!timer.current) { stop(); controller.current.begin(viewport.current); }
        else clearTimeout(timer.current);
        const previous = restoreValidViewport(viewport.current), k = Math.min(5, Math.max(.05, value));
        controller.current.move({
            x: size.width / 2 - (size.width / 2 - previous.x) / previous.k * k,
            y: size.height / 2 - (size.height / 2 - previous.y) / previous.k * k, k,
        });
        timer.current = setTimeout(() => { timer.current = null; controller.current?.finish(); }, 120);
    }, [controller, size.width, size.height, stop, viewport]);
}
