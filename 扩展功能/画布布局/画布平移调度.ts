import type { ViewportTransform } from "@/types/canvas";
import { restoreValidViewport, validCanvasViewport } from "../画布交互/有效视区";

// Leave 40px of the minimum 140px screen overscan for the next commit.
const PAN_CHECKPOINT_PX = 100;

export function createCanvasPanScheduler({ paint, commit, frame, cancel, now, probe }: {
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
    const changed = () => latest && checkpoint && (latest.x !== checkpoint.x || latest.y !== checkpoint.y || latest.k !== checkpoint.k);
    const publish = () => {
        if (!latest || !changed()) return;
        checkpoint = latest;
        const started = now();
        commit(latest);
        probe?.commit(now() - started);
    };
    return {
        begin(viewport: ViewportTransform, measure = true) {
            if (pending !== null) cancel(pending);
            pending = null; latest = restoreValidViewport(viewport); checkpoint = latest;
            if (measure) probe?.begin();
        },
        move(viewport: ViewportTransform) {
            if (!validCanvasViewport(viewport)) return;
            latest = viewport;
            if (pending !== null) return;
            pending = frame(() => {
                pending = null;
                if (!latest) return;
                const started = now(); paint(latest); probe?.paint(now() - started);
                // 缩放中保持已绘制内容，仅变换合成层；结束后再更新视区裁剪和内容。
                if (checkpoint && latest.k !== checkpoint.k) return;
                if (!checkpoint || Math.max(Math.abs(latest.x - checkpoint.x), Math.abs(latest.y - checkpoint.y)) >= PAN_CHECKPOINT_PX) publish();
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
