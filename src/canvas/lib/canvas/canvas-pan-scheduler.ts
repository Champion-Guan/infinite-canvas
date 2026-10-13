import type { ViewportTransform } from "@/types/canvas";

// Paint the latest pointer once per frame; expensive scene culling and React
// work only checkpoint periodically or before crossing the culling overscan.
export function createCanvasPanScheduler({ paint, commit, frame, cancel, now, extent }: {
    paint: (viewport: ViewportTransform) => void;
    commit: (viewport: ViewportTransform) => void;
    frame: (callback: () => void) => number;
    cancel: (id: number) => void;
    now: () => number;
    extent?: () => { width: number; height: number };
}) {
    let pending: number | null = null;
    let latest: ViewportTransform | null = null;
    let checkpoint: ViewportTransform | null = null;
    let checkpointAt = 0;
    const changed = () => latest && checkpoint && (latest.x !== checkpoint.x || latest.y !== checkpoint.y || latest.k !== checkpoint.k);
    const publish = () => {
        if (!latest || !changed()) return;
        checkpoint = latest;
        checkpointAt = now();
        commit(latest);
    };
    return {
        begin(viewport: ViewportTransform) {
            if (pending !== null) cancel(pending);
            pending = null; latest = viewport; checkpoint = viewport; checkpointAt = now();
        },
        move(viewport: ViewportTransform) {
            latest = viewport;
            if (pending !== null) return;
            pending = frame(() => {
                pending = null;
                if (!latest) return;
                paint(latest);
                const overscanStep = 140 * latest.k;
                const size = extent?.();
                const zoomTravel = checkpoint && size ? Math.max(
                    Math.abs((size.width - checkpoint.x) / checkpoint.k - (size.width - latest.x) / latest.k),
                    Math.abs((size.height - checkpoint.y) / checkpoint.k - (size.height - latest.y) / latest.k),
                    Math.abs(checkpoint.x / checkpoint.k - latest.x / latest.k),
                    Math.abs(checkpoint.y / checkpoint.k - latest.y / latest.k),
                ) : latest.k !== checkpoint?.k ? Infinity : 0;
                if (!checkpoint || zoomTravel >= 140 || now() - checkpointAt >= 80
                    || Math.abs(latest.x - checkpoint.x) >= overscanStep || Math.abs(latest.y - checkpoint.y) >= overscanStep) publish();
            });
        },
        flush() {
            if (pending !== null) cancel(pending);
            pending = null;
            if (latest) paint(latest);
            publish();
            return latest;
        },
        dispose() { if (pending !== null) cancel(pending); pending = null; latest = null; },
        get latest() { return latest; },
    };
}
