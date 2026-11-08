import { useEffect, useSyncExternalStore } from "react";

const subscribeVisibility = (listener: () => void) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
};
export function usePageVisible() {
    return useSyncExternalStore(subscribeVisibility, () => document.visibilityState !== "hidden", () => true);
}

// 完成一次才安排下一次；隐藏、卸载时取消等待，不能积压慢请求。
export function startVisiblePolling(refresh: () => Promise<void>, interval: number, { immediate = true } = {}) {
    let stopped = false, reading = false, timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => document.visibilityState !== "hidden";
    const clear = () => { clearTimeout(timer); timer = undefined; };
    const tick = async () => {
        clear();
        if (stopped || reading || !visible()) return;
        reading = true;
        try { await refresh(); }
        catch { /* 具体错误由读取入口呈现，失败后仍可重试。 */ }
        finally {
            reading = false;
            if (!stopped && visible()) timer = setTimeout(() => { void tick(); }, interval);
        }
    };
    const visibility = () => { if (!visible()) clear(); else void tick(); };
    document.addEventListener("visibilitychange", visibility);
    if (immediate) void tick();
    else if (visible()) timer = setTimeout(() => { void tick(); }, interval);
    return () => { stopped = true; clear(); document.removeEventListener("visibilitychange", visibility); };
}

export function useVisiblePolling(active: boolean, refresh: () => Promise<void>, interval: number, immediate = true) {
    useEffect(() => active ? startVisiblePolling(refresh, interval, { immediate }) : undefined,
        [active, refresh, interval, immediate]);
}
