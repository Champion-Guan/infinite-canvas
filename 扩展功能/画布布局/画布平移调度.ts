import type { ViewportTransform } from "@/types/canvas";
import { restoreValidViewport, validCanvasViewport } from "../画布交互/有效视区";

// Paint the latest pointer once per frame; expensive scene culling and React
// work only checkpoint periodically or before crossing the culling overscan.
export function createCanvasPanScheduler({ paint, commit, frame, cancel, now, extent, probe }: {
    paint: (viewport: ViewportTransform) => void;
    commit: (viewport: ViewportTransform) => void;
    frame: (callback: () => void) => number;
    cancel: (id: number) => void;
    now: () => number;
    extent?: () => { width: number; height: number };
    probe?: { begin(): void; paint(duration: number): void; commit(duration: number): void; finish(): void; dispose(): void };
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
        const started = now();
        commit(latest);
        probe?.commit(now() - started);
    };
    return {
        begin(viewport: ViewportTransform, measure = true) {
            if (pending !== null) cancel(pending);
            pending = null; latest = restoreValidViewport(viewport); checkpoint = latest; checkpointAt = now();
            if (measure) probe?.begin();
        },
        move(viewport: ViewportTransform) {
            if (!validCanvasViewport(viewport)) return;
            latest = viewport;
            if (pending !== null) return;
            pending = frame(() => {
                pending = null;
                if (!latest) return;
                const size = extent?.();
                const started = now(); paint(latest); probe?.paint(now() - started);
                // Culling overscan is measured in screen pixels, not world
                // pixels: zooming out must not make a few pixels trigger React.
                const overscanStep = 140;
                const zoomTravel = checkpoint && size ? Math.max(
                    Math.abs((size.width - checkpoint.x) / checkpoint.k - (size.width - latest.x) / latest.k),
                    Math.abs((size.height - checkpoint.y) / checkpoint.k - (size.height - latest.y) / latest.k),
                    Math.abs(checkpoint.x / checkpoint.k - latest.x / latest.k),
                    Math.abs(checkpoint.y / checkpoint.k - latest.y / latest.k),
                ) : latest.k !== checkpoint?.k ? Infinity : 0;
                // 缩放中保持已绘制内容，仅变换合成层；结束后再更新视区裁剪和内容。
                if (checkpoint && latest.k !== checkpoint.k) return;
                if (!checkpoint || zoomTravel * latest.k >= overscanStep || now() - checkpointAt >= 80
                    || Math.abs(latest.x - checkpoint.x) >= overscanStep || Math.abs(latest.y - checkpoint.y) >= overscanStep) publish();
            });
        },
        flush() {
            if (pending !== null) cancel(pending);
            pending = null;
            if (latest) paint(latest);
            publish();
            probe?.finish();
            return latest;
        },
        dispose() { if (pending !== null) cancel(pending); pending = null; latest = null; probe?.dispose(); },
        get latest() { return latest; },
    };
}
