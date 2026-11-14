import { 本地转发地址, 本地转发请求 } from "../网络代理/本地转发请求";

const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_ITEMS = 64;
const cache = new Map<string, Blob>();
type Flight = { promise: Promise<Blob>; controller: AbortController; users: number };
const pending = new Map<string, Flight>();
let cacheBytes = 0;
let queue: Promise<void> = Promise.resolve();

export function readPromptImage(url: string, signal?: AbortSignal): Promise<Blob> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const saved = cache.get(url);
    if (saved) {
        cache.delete(url); cache.set(url, saved);
        return Promise.resolve(saved);
    }
    const current = pending.get(url);
    if (current && !current.controller.signal.aborted) return consume(current, signal);
    const controller = new AbortController();
    let flight: Flight;
    const task = queue.then(async () => {
        controller.signal.throwIfAborted();
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") throw Error("提示词图片需要公开 HTTPS 地址。");
        const response = await 本地转发请求(本地转发地址(url), { headers: { accept: "image/*" },
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
        if (!response.ok) throw Error(`图片读取失败（${response.status}）`);
        const blob = await response.blob();
        controller.signal.throwIfAborted();
        if (!blob.size || !blob.type.startsWith("image/")) throw Error("来源未返回有效图片。");
        if (blob.size <= MAX_CACHE_BYTES) {
            while (cache.size >= MAX_CACHE_ITEMS || cacheBytes + blob.size > MAX_CACHE_BYTES) {
                const oldest = cache.keys().next().value;
                if (!oldest) break;
                cacheBytes -= cache.get(oldest)!.size; cache.delete(oldest);
            }
            cache.set(url, blob); cacheBytes += blob.size;
        }
        return blob;
    }).finally(() => { if (pending.get(url) === flight) pending.delete(url); });
    flight = { promise: task, controller, users: 0 };
    pending.set(url, flight);
    // 图片逐张读取，避免可见缩略图同时占满本机转发入口。
    queue = task.then(() => undefined, () => undefined);
    return consume(flight, signal);
}

function consume(flight: Flight, signal?: AbortSignal): Promise<Blob> {
    flight.users++;
    return new Promise((resolve, reject) => {
        let finished = false;
        const finish = () => {
            if (finished) return false;
            finished = true; signal?.removeEventListener("abort", abort);
            if (--flight.users === 0) flight.controller.abort();
            return true;
        };
        const abort = () => { if (finish()) reject(signal?.reason); };
        signal?.addEventListener("abort", abort, { once: true });
        flight.promise.then(blob => { if (finish()) resolve(blob); }, error => { if (finish()) reject(error); });
    });
}
