import { useEffect } from "react";

export const PROXY_STATUS_INTERVAL_MS = 5000;

// 每次读取结束后再计时；仅当前可见页签订阅，后台不积压请求。
export function useProxyStatusRefresh(active: boolean, refresh: () => Promise<void>) {
    useEffect(() => {
        if (!active) return;
        let stopped = false, reading = false, timer: ReturnType<typeof setTimeout> | undefined;
        const clear = () => { clearTimeout(timer); timer = undefined; };
        const tick = async () => {
            clear();
            if (stopped || reading || document.visibilityState !== "visible") return;
            reading = true;
            try { await refresh(); }
            catch { /* 具体错误由面板呈现，下一轮继续读取。 */ }
            finally {
                reading = false;
                if (!stopped && document.visibilityState === "visible") timer = setTimeout(() => { void tick(); }, PROXY_STATUS_INTERVAL_MS);
            }
        };
        const visibility = () => { if (document.visibilityState === "visible") void tick(); else clear(); };
        void tick();
        document.addEventListener("visibilitychange", visibility);
        return () => { stopped = true; clear(); document.removeEventListener("visibilitychange", visibility); };
    }, [active, refresh]);
}
