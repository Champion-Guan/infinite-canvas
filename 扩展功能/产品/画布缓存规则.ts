export const PRODUCT_CANVAS_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export function retainedProductCanvases(previous: readonly string[], activeId: string, existing: ReadonlySet<string>) {
    const retained = previous.filter(id => existing.has(id) && id !== activeId);
    if (activeId && existing.has(activeId)) retained.push(activeId);
    return retained;
}

type ReleasePort = {
    residents(): readonly string[];
    active(): string;
    eligible(id: string): boolean;
    activity(id: string): number;
    prepare(id: string): Promise<(() => boolean) | null>;
    release(id: string, stillCurrent: () => boolean): void;
    schedule(callback: () => void, delay: number): () => void;
    now(): number;
    idleTimeout?: number;
};

// 仅保存空闲时间与活动代次，不复制画布。整个工作区只保留一个最近到期计时器。
export function createProductCanvasCache(port: ReleasePort) {
    type Idle = { since: number; activity: number; attempted: boolean };
    const idle = new Map<string, Idle>();
    const timeout = port.idleTimeout ?? PRODUCT_CANVAS_IDLE_TIMEOUT_MS;
    let stopped = false, flight = false, preparing: string | null = null;
    let cancel: (() => void) | null = null;
    const sync = () => {
        const residents = new Set(port.residents());
        for (const id of idle.keys()) if (!residents.has(id)) idle.delete(id);
        for (const id of residents) {
            const previous = idle.get(id), activity = port.activity(id);
            if (id === port.active() || previous && previous.activity !== activity) idle.delete(id);
            if (id === port.active()) continue;
            // 自己准备休眠时会暂时写入SQLite；不把这些内部通知当成新的用户活动。
            if (id === preparing) continue;
            if (!port.eligible(id)) { idle.delete(id); continue; }
            if (!idle.has(id)) idle.set(id, { since: port.now(), activity, attempted: false });
        }
    };
    const arm = () => {
        cancel?.(); cancel = null;
        if (stopped || flight) return;
        const due = [...idle.values()].filter(entry => !entry.attempted).map(entry => entry.since + timeout);
        if (!due.length) return;
        cancel = port.schedule(() => { cancel = null; void sweep(); }, Math.max(0, Math.min(...due) - port.now()));
    };
    const sweep = async () => {
        if (stopped || flight) return;
        sync(); flight = true;
        try {
            for (const [id, entry] of idle) {
                if (stopped) break;
                if (entry.attempted || port.now() - entry.since < timeout || id === port.active() || !port.eligible(id)) continue;
                entry.attempted = true; preparing = id;
                let valid: (() => boolean) | null = null;
                try { valid = await port.prepare(id); } catch (error) {
                    console.debug("[画布缓存] 休眠未确认，保留实例", error instanceof Error ? error.message : "保存失败");
                }
                const stillCurrent = () => !stopped && idle.get(id) === entry && entry.activity === port.activity(id)
                    && id !== port.active() && port.residents().includes(id) && port.eligible(id) && valid?.() === true;
                if (stillCurrent()) port.release(id, stillCurrent);
                preparing = null;
            }
        } finally { preparing = null; flight = false; if (!stopped) { sync(); arm(); } }
    };
    const request = () => {
        if (stopped) return;
        sync();
        // 失败只等外部状态变化后重新计时，自己的保存通知不能创建重试循环。
        if (!flight) for (const entry of idle.values()) if (entry.attempted) {
            entry.since = port.now(); entry.attempted = false;
        }
        arm();
    };
    return {
        request,
        changed: request,
        dispose() { stopped = true; cancel?.(); cancel = null; idle.clear(); },
    };
}
