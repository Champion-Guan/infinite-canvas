import type { ViewportTransform } from "@/types/canvas";

export function validCanvasViewport(value: unknown): value is ViewportTransform {
    const viewport = value as ViewportTransform | null;
    return Boolean(viewport && [viewport.x, viewport.y, viewport.k].every(Number.isFinite) && viewport.k > 0);
}

export function restoreValidViewport(value: unknown): ViewportTransform {
    return validCanvasViewport(value) ? { ...value, k: Math.max(.05, Math.min(5, value.k)) } : { x: 0, y: 0, k: 1 };
}
