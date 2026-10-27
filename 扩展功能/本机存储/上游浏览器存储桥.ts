// 根目录唯一维护来源；画布和失败通知共用本页保存状态与恢复队列。
function shouldSkipStorageWrite(cache: ReadonlyMap<string, string>, failed: ReadonlyMap<string, unknown>, cacheKey: string, value: string, failureKey: string) {
    return cache.get(cacheKey) === value && !failed.has(failureKey);
}
function shouldSkipStorageRemove(cache: ReadonlyMap<string, string>, failed: ReadonlyMap<string, unknown>, cacheKey: string, failureKey: string) {
    return !cache.has(cacheKey) && !failed.has(failureKey);
}
export interface SQLiteInstance {
    getItem<T>(key: string): Promise<T | null>;
    setItem<T>(key: string, value: T): Promise<T>;
    removeItem(key: string): Promise<unknown>;
    removeItems(keys: string[]): Promise<unknown>;
    clear(): Promise<unknown>;
    iterate<T, U>(iterator: (value: T, key: string, index: number) => U | void): Promise<U | void>;
}
export type SQLiteUsage = {
    usage: number; quota: number | null; contentBytes: number;
    databases: Array<{ name: string; version: number; bytes: number; stores: Array<{ name: string; records: number; bytes: number }> }>;
};
type RuntimeStatus = { state: string; pending: number; errors: string[]; retrying?: boolean; failures?: Array<{ namespace: string; code: string; stage?: string; status?: number | null }> };
export interface SQLiteRuntime {
    createInstance(options: { name?: string; storeName?: string }): SQLiteInstance;
    flush(): Promise<unknown>;
    getStatus(): RuntimeStatus;
    readUsage(): Promise<SQLiteUsage>;
    retryPending(): Promise<unknown>;
    mediaIdsForKeys(groups: Record<string, string[]>): Promise<string[]>;
    purgeMedia(ids: string[]): Promise<{ deleted: string[]; retained: string[]; deferred: string[] }>;
    subscribe(callback: () => void): () => void;
}
declare global { interface Window { __guanSQLiteHost?: { initialize(): Promise<SQLiteRuntime>; reconnect?(): Promise<void> }; } }
let runtime: SQLiteRuntime | null = null;
let appState: SQLiteInstance, preferencesStore: SQLiteInstance;
const stateCache = new Map<string, string>(), preferencesCache = new Map<string, string>(), sessionCache = new Map<string, string>();
const writes = new Set<Promise<unknown>>(), failed = new Map<string, unknown>();
const scheduled = new Map<string, { value: string; queuedAt: number; timer: ReturnType<typeof setTimeout>; resolve: () => void; reject: (reason: unknown) => void; promise: Promise<void> }>();
const activeSaves = new Set<string>();
let retryFlight: Promise<void> | null = null;
let reconnecting = false, reconnectError: string | null = null;
function ready() { if (!runtime) throw new Error("本机存储尚未初始化，不允许退回浏览器数据库。"); return runtime; }
export function storageStatus() {
    const current = runtime?.getStatus();
    const codes = [...(current?.failures?.map(item => item.code) ?? []), ...[...failed.values()].map(error => (error as { code?: string } | null)?.code)];
    return { state: failed.size || current?.state === "error" ? "error" : writes.size || scheduled.size || current?.pending ? "saving" : current?.state === "idle" && stateCache.size > 0 ? "saved" : current?.state ?? "idle",
        pending: Math.max(writes.size, current?.pending ?? 0) + scheduled.size, retrying: !!retryFlight || !!current?.retrying,
        conflict: codes.includes("revision_conflict"), reconnectRequired: codes.includes("session_expired"), reconnecting,
        failure: current?.failures?.[0] ?? null,
        reconnectError: reconnectError ?? codes.find(code => ["authorization_expired", "authorization_denied", "lease_expired", "session_host_closed"].includes(code ?? "")) ?? null };
}
function statusChanged() { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("guan:storage-status", { detail: storageStatus() })); }
function track<T>(key: string, promise: Promise<T>) {
    writes.add(promise); statusChanged();
    promise.then(() => failed.delete(key), error => failed.set(key, error)).finally(() => { writes.delete(promise); statusChanged(); });
    return promise;
}
export async function initializeSQLiteApplication() {
    if (runtime) return;
    if (typeof window === "undefined" || !window.__guanSQLiteHost) throw new Error("本机SQLite服务尚未授权接入，未使用浏览器存储。");
    const candidate = await window.__guanSQLiteHost.initialize();
    if (typeof candidate.retryPending !== "function" || typeof candidate.subscribe !== "function") throw new Error("保存恢复协议不兼容，不能作为空库启动。");
    const app = candidate.createInstance({ name: "infinite-canvas", storeName: "app_state" });
    const prefs = candidate.createInstance({ name: "infinite-canvas", storeName: "preferences" });
    const nextState = new Map<string, string>(), nextPreferences = new Map<string, string>();
    await app.iterate<unknown, void>((value, key) => {
        if (typeof value !== "string") throw new Error("应用状态格式错误，未作为空库继续。");
        const parsed: unknown = JSON.parse(value);
        if (!parsed || typeof parsed !== "object" || !("state" in parsed) || !parsed.state || typeof parsed.state !== "object") throw new Error("应用状态结构错误，停止初始化。");
        nextState.set(key, value);
    });
    await prefs.iterate<unknown, void>((value, key) => { if (typeof value !== "string") throw new Error("偏好设置格式错误，停止初始化。"); nextPreferences.set(key, value); });
    for (const [key, value] of nextState) stateCache.set(key, value);
    for (const [key, value] of nextPreferences) preferencesCache.set(key, value);
    appState = app; preferencesStore = prefs; runtime = candidate;
    Object.defineProperty(window, "__guanPrepareUpdate", { value: flushSQLiteStorage });
    candidate.subscribe(statusChanged);
    window.addEventListener("beforeunload", event => { const status = storageStatus(); if (status.state === "saving" || status.state === "error") { event.preventDefault(); event.returnValue = ""; } });
    statusChanged();
}
export const sqliteStateStorage = {
    getItem(key: string) { ready(); return stateCache.get(key) ?? null; },
    setItem(key: string, value: string) {
        ready();
        const failureKey = "state:" + key;
        if (shouldSkipStorageWrite(stateCache, failed, key, value, failureKey)) return Promise.resolve();
        stateCache.set(key, value);
        return track(failureKey, appState.setItem(key, value).then(() => {}));
    },
    removeItem(key: string) {
        ready();
        const failureKey = "state:" + key;
        if (shouldSkipStorageRemove(stateCache, failed, key, failureKey)) return Promise.resolve();
        stateCache.delete(key);
        return track(failureKey, appState.removeItem(key).then(() => {}));
    },
};
export const sqlitePreferences = {
    getItem(key: string) { ready(); return preferencesCache.get(key) ?? null; },
    setItem(key: string, value: string) {
        ready();
        const failureKey = "pref:" + key;
        if (shouldSkipStorageWrite(preferencesCache, failed, key, value, failureKey)) return;
        preferencesCache.set(key, value);
        track(failureKey, preferencesStore.setItem(key, value));
    },
    removeItem(key: string) {
        ready();
        const failureKey = "pref:" + key;
        if (shouldSkipStorageRemove(preferencesCache, failed, key, failureKey)) return;
        preferencesCache.delete(key);
        track(failureKey, preferencesStore.removeItem(key));
    },
};
export const sessionMemory = { getItem: (key: string) => sessionCache.get(key) ?? null, setItem: (key: string, value: string) => { sessionCache.set(key, value); } };
export const sqliteForage = { createInstance(options: { name?: string; storeName?: string }) { return ready().createInstance(options); } };
function startScheduled(key: string) {
    const entry = scheduled.get(key); if (!entry || activeSaves.has(key)) return;
    clearTimeout(entry.timer); scheduled.delete(key); activeSaves.add(key);
    const finish = () => { activeSaves.delete(key); startScheduled(key); };
    // 只合并尚未发送的完整快照；在途及失败操作保留原恢复队列和operationId。
    sqliteStateStorage.setItem(key, entry.value).then(() => { finish(); entry.resolve(); }, error => { finish(); entry.reject(error); });
}
export function scheduleStateSave(key: string, value: string) {
    ready();
    if (!scheduled.has(key) && shouldSkipStorageWrite(stateCache, failed, key, value, "state:" + key)) return Promise.resolve();
    const existing = scheduled.get(key);
    // 空闲时短暂停笔80ms提交，持续输入最迟250ms启动；在途期间只保留最新候选。
    if (existing) { existing.value = value; clearTimeout(existing.timer); existing.timer = setTimeout(() => startScheduled(key), Math.max(0, Math.min(80, 250 - (performance.now() - existing.queuedAt)))); return existing.promise; }
    let resolve!: () => void, reject!: (reason: unknown) => void;
    const promise = new Promise<void>((success, failure) => { resolve = success; reject = failure; });
    scheduled.set(key, { value, queuedAt: performance.now(), timer: setTimeout(() => startScheduled(key), 80), resolve, reject, promise });
    promise.catch(() => {}); statusChanged(); return promise;
}
export async function flushSQLiteStorage() {
    ready();
    do { for (const key of [...scheduled.keys()]) startScheduled(key); await Promise.all([...writes]); }
    while (writes.size || scheduled.size);
    await runtime!.flush();
    if (failed.size || writes.size || scheduled.size) throw new Error("本机保存尚未确认，不能继续关闭或切换服务。");
}
function retryStorage(reconnect: boolean): Promise<void> {
    const app = ready();
    if (!retryFlight) {
        reconnecting = reconnect; reconnectError = null;
        retryFlight = (async () => {
            for (const key of [...scheduled.keys()]) startScheduled(key);
            await Promise.allSettled([...writes]);
            if (reconnect) {
                if (storageStatus().conflict) throw new Error("存在版本冲突，不能通过重新连接覆盖。");
                if (typeof window.__guanSQLiteHost?.reconnect !== "function") throw new Error("保留页面重新连接协议不可用。");
                try { await window.__guanSQLiteHost.reconnect(); }
                catch (error) { reconnectError = typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : "connection_failed"; throw error; }
            }
            await app.retryPending();
            // 重试期间用户仍可能编辑；这些新操作也必须收到ACK，不能只清掉旧错误。
            for (const key of [...scheduled.keys()]) startScheduled(key);
            await Promise.allSettled([...writes]); await app.flush();
            if (writes.size || scheduled.size || app.getStatus().state === "error" || app.getStatus().pending) throw new Error("仍有未确认编辑，请勿关闭或刷新。");
            failed.clear();
        })();
        retryFlight.then(() => { retryFlight = null; reconnecting = false; statusChanged(); }, () => { retryFlight = null; reconnecting = false; statusChanged(); });
        statusChanged();
    }
    return retryFlight;
}
export function retrySQLiteStorage(): Promise<void> { return retryStorage(false); }
export function reconnectAndRetrySQLiteStorage(): Promise<void> { return retryStorage(true); }
export function readSQLiteUsage() { return ready().readUsage(); }

export function recycleMediaIds(groups: Record<string, string[]>) { return ready().mediaIdsForKeys(groups); }
export function purgeRecycleMedia(ids: string[]) { return ready().purgeMedia(ids); }
