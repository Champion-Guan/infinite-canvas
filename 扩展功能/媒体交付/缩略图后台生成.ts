type Job = { blob: Blob; maxEdge: number; resolve(value?: Blob): void; reject(error: Error): void };
type Slot = { worker: Worker; job?: Job; timer?: ReturnType<typeof setTimeout> };
const slots: Slot[] = [], waiting: Job[] = [];
let idleTimer: ReturnType<typeof setTimeout> | undefined;

export function imagePreviewParallelism() {
    const cores = typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4;
    return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

function drain() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
    while (waiting.length) {
        let slot = slots.find(item => !item.job);
        if (!slot && slots.length < imagePreviewParallelism()) {
            try {
                const created: Slot = { worker: new Worker(new URL("./缩略图生成工作线程.ts", import.meta.url), { type: "module" }) };
                const finish = (error?: Error, blob?: Blob) => {
                    const job = created.job;
                    clearTimeout(created.timer); created.timer = undefined; created.job = undefined;
                    if (error) {
                        created.worker.terminate();
                        const index = slots.indexOf(created); if (index >= 0) slots.splice(index, 1);
                        job?.reject(error);
                    } else job?.resolve(blob);
                    drain();
                };
                created.worker.onmessage = ({ data }: MessageEvent<{ blob?: Blob; error?: string }>) =>
                    finish(data.error ? new Error(data.error) : undefined, data.blob);
                created.worker.onerror = () => finish(new Error("后台图像线程不可用"));
                slots.push(created); slot = created;
            } catch (error) {
                waiting.shift()!.reject(error instanceof Error ? error : new Error("无法启动后台图像线程"));
                continue;
            }
        }
        if (!slot) return;
        const assigned = waiting.shift()!;
        slot.job = assigned;
        const current = slot;
        current.timer = setTimeout(() => {
            const job = current.job; current.job = undefined; current.worker.terminate();
            const index = slots.indexOf(current); if (index >= 0) slots.splice(index, 1);
            job?.reject(new Error("后台缩略图生成超时")); drain();
        }, 30_000);
        try { current.worker.postMessage({ blob: assigned.blob, maxEdge: assigned.maxEdge }); }
        catch (error) {
            clearTimeout(current.timer);
            const job = current.job; current.job = undefined; current.worker.terminate();
            slots.splice(slots.indexOf(current), 1);
            job?.reject(error instanceof Error ? error : new Error("无法发送后台图像任务"));
        }
    }
    if (slots.every(slot => !slot.job)) idleTimer = setTimeout(() => {
        slots.splice(0).forEach(slot => slot.worker.terminate());
        idleTimer = undefined;
    }, 60_000);
}

export async function createImageThumbnailInBackground(blob: Blob, fallback: () => Promise<Blob | undefined>, maxEdge = 768) {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return fallback();
    try {
        return await new Promise<Blob | undefined>((resolve, reject) => { waiting.push({ blob, maxEdge, resolve, reject }); drain(); });
    } catch { return fallback(); }
}
