import { canPreparePageUpgrade, flushPageUpgrade } from "../软件更新/升级页面状态.mjs";
import { globalPlatformRules } from "../Excel画布/平台规则全局状态";
// 根目录唯一维护来源；画布和失败通知共用本页保存状态与恢复队列。
function shouldSkipStorageWrite(cache: ReadonlyMap<string, string>, failed: ReadonlyMap<string, unknown>, cacheKey: string, value: string, failureKey: string) {
    return cache.get(cacheKey) === value && !failed.has(failureKey);
}
function shouldSkipStorageRemove(cache: ReadonlyMap<string, string>, failed: ReadonlyMap<string, unknown>, cacheKey: string, failureKey: string) {
    return !cache.has(cacheKey) && !failed.has(failureKey);
}
export interface SQLiteInstance {
    getItem<T>(key: string): Promise<T | null>;
    keys(): Promise<string[]>;
    setItem<T>(key: string, value: T): Promise<T>;
    removeItem(key: string): Promise<unknown>;
    removeItems(keys: string[]): Promise<unknown>;
    clear(): Promise<unknown>;
    iterate<T, U>(iterator: (value: T, key: string, index: number) => U | void): Promise<U | void>;
    iterateDecodedState?<T, U>(iterator: (value: T, key: string, index: number) => U | void): Promise<U | void>;
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
declare global { interface Window { __guanSQLiteHost?: { initialize(): Promise<SQLiteRuntime>; reconnect?(options?: { reason?: string }): Promise<void> }; } }
let runtime: SQLiteRuntime | null = null;
let appState: SQLiteInstance, preferencesStore: SQLiteInstance;
const stateCache = new Map<string, string>(), preferencesCache = new Map<string, string>(), sessionCache = new Map<string, string>();
const decodedStateCache = new Map<string, unknown>();
const writes = new Set<Promise<unknown>>(), failed = new Map<string, unknown>();
type StateSaveValue = string | (() => string);
const scheduled = new Map<string, { value: StateSaveValue; queuedAt: number; timer: ReturnType<typeof setTimeout>; resolve: () => void; reject: (reason: unknown) => void; promise: Promise<void> }>();
const encodingFailures = new Map<string, StateSaveValue>();
const activeSaves = new Set<string>();
let retryFlight: Promise<void> | null = null;
let reconnecting = false, reconnectError: string | null = null;
// 会话过期、拒绝或连接中断都保留页面内的原操作，点击重试时先恢复同一会话。
// 重试只复用原队列和 operationId，不重新创建任务或兑换授权码。
// 普通网络错误不代表页面授权已经失效。先用原 operationId 重试，
// 只有服务明确报告会话失效或授权响应丢失时才恢复当前会话。
const SESSION_RECOVERY_ERRORS = new Set(["session_expired", "session_denied", "authorization_connection_failed"]);
const AUTHORIZATION_END_ERRORS = new Set(["authorization_expired", "authorization_denied", "lease_expired", "session_host_closed"]);
function ready() { if (!runtime) throw new Error("本机存储尚未初始化，不允许退回浏览器数据库。"); return runtime; }
export function storageStatus() {
    const current = runtime?.getStatus();
    const codes = [...(current?.failures?.map(item => item.code) ?? []), ...[...failed.values()].map(error => (error as { code?: string } | null)?.code)];
    return { state: failed.size || current?.state === "error" ? "error" : writes.size || scheduled.size || current?.pending ? "saving" : current?.state === "idle" && stateCache.size + decodedStateCache.size > 0 ? "saved" : current?.state ?? "idle",
        pending: Math.max(writes.size, current?.pending ?? 0) + scheduled.size + encodingFailures.size, retrying: !!retryFlight || !!current?.retrying,
        conflict: codes.includes("revision_conflict"), reconnectRequired: codes.some(code => SESSION_RECOVERY_ERRORS.has(code ?? "")), reconnecting,
        failure: current?.failures?.[0] ?? null,
        reconnectError: reconnectError ?? codes.find(code => AUTHORIZATION_END_ERRORS.has(code ?? "")) ?? null };
}
function statusChanged() { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("guan:storage-status", { detail: storageStatus() })); }
function failureCodes(app: SQLiteRuntime) {
    return new Set([
        ...[...failed.values()].map(error => (error as { code?: unknown } | null)?.code),
        ...(app.getStatus().failures ?? []).map(item => item.code),
    ]);
}
function needsSessionRecovery(app: SQLiteRuntime, error?: unknown) {
    const code = (error as { code?: unknown } | null)?.code;
    const codes = failureCodes(app);
    return SESSION_RECOVERY_ERRORS.has(typeof code === "string" ? code : "") ||
        [...codes].some(value => typeof value === "string" && SESSION_RECOVERY_ERRORS.has(value));
}
function isConflict(app: SQLiteRuntime) {
    return failureCodes(app).has("revision_conflict");
}
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
    const nextState = new Map<string, string>(), nextPreferences = new Map<string, string>(), nextDecoded = new Map<string, unknown>();
    const projects: NonNullable<Parameters<typeof globalPlatformRules.initialize>[1]> = [];
    const readState = app.iterateDecodedState?.bind(app) ?? app.iterate.bind(app);
    await Promise.all([readState<unknown, void>((value, key) => {
        const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
        if (!parsed || typeof parsed !== "object" || !("state" in parsed) || !parsed.state || typeof parsed.state !== "object") throw new Error("应用状态结构错误，停止初始化。");
        if (typeof value === "string") nextState.set(key, value);
        nextDecoded.set(key, parsed);
        if ("projects" in parsed.state && Array.isArray(parsed.state.projects)) projects.push(...parsed.state.projects);
    }), prefs.iterate<unknown, void>((value, key) => {
        // 兼容早期中断删除留下的对象清单；恢复入口读取原清单，不把工作台启动为默认空数据。
        if (key === "guan-recycle-cleanup:v1" && value && typeof value === "object") value = JSON.stringify(value);
        if (typeof value !== "string") throw new Error("偏好设置格式错误，停止初始化。");
        nextPreferences.set(key, value);
    })]);
    for (const [key, value] of nextState) stateCache.set(key, value);
    decodedStateCache.clear();
    for (const [key, value] of nextDecoded) decodedStateCache.set(key, value);
    for (const [key, value] of nextPreferences) preferencesCache.set(key, value);
    appState = app; preferencesStore = prefs; runtime = candidate;
    try {
        await globalPlatformRules.initialize({
            getItem: key => sqlitePreferences.getItem(key),
            setItem: (key, value) => sqlitePreferences.setItem(key, value),
            flush: async () => {
                if (failed.size) await retrySQLiteStorage();
                await flushSQLiteStorage();
            },
        }, projects);
    } catch (error) { runtime = null; throw error; }
    Object.defineProperty(window, "__guanReadUpdateState", { value: () => ({ ready: canPreparePageUpgrade() && !storageStatus().conflict && !reconnecting }) });
    Object.defineProperty(window, "__guanPrepareUpdate", { value: async () => {
        try { await flushPageUpgrade(); await flushSQLiteStorage(); }
        catch (error) {
            if (storageStatus().conflict) throw error;
            await retrySQLiteStorage();
            await flushPageUpgrade(); await flushSQLiteStorage();
        }
    } });
    candidate.subscribe(statusChanged);
    window.addEventListener("beforeunload", event => { const status = storageStatus(); if (status.state === "saving" || status.state === "error") { event.preventDefault(); event.returnValue = ""; } });
    statusChanged();
}
export const sqliteStateStorage = {
    getItem(key: string) {
        ready();
        if (!stateCache.has(key) && decodedStateCache.has(key)) stateCache.set(key, JSON.stringify(decodedStateCache.get(key)));
        return stateCache.get(key) ?? null;
    },
    // 与不可变store共用初始化对象；首次真实保存后释放该初始引用。
    takeDecodedState<T>(key: string): T | null {
        ready();
        const value = decodedStateCache.get(key);
        if (value === undefined) return null;
        return value as T;
    },
    setItem(key: string, value: string) {
        ready();
        decodedStateCache.delete(key);
        const failureKey = "state:" + key;
        if (shouldSkipStorageWrite(stateCache, failed, key, value, failureKey)) return Promise.resolve();
        stateCache.set(key, value);
        return track(failureKey, appState.setItem(key, value).then(() => {}));
    },
    removeItem(key: string) {
        ready();
        decodedStateCache.delete(key);
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
    const finish = () => { activeSaves.delete(key); startScheduled(key); statusChanged(); };
    let value: string;
    try {
        // 合并不可变快照后才编码，避免每次编辑遍历整份产品数据。
        value = typeof entry.value === "function" ? entry.value() : entry.value;
        entry.value = value;
        encodingFailures.delete(key); failed.delete("encode:" + key);
    } catch (error) {
        encodingFailures.set(key, entry.value); failed.set("encode:" + key, error);
        finish(); entry.reject(error); return;
    }
    // 只合并尚未发送的完整快照；在途及失败操作保留原恢复队列和operationId。
    let write: Promise<void>;
    try { write = sqliteStateStorage.setItem(key, value); }
    catch (error) {
        encodingFailures.set(key, value); failed.set("state:" + key, error);
        finish(); entry.reject(error); return;
    }
    write.then(() => { finish(); entry.resolve(); }, error => { finish(); entry.reject(error); });
}
export function scheduleStateSave(key: string, value: StateSaveValue) {
    ready();
    if (!scheduled.has(key) && !encodingFailures.has(key) && typeof value === "string" && shouldSkipStorageWrite(stateCache, failed, key, value, "state:" + key)) return Promise.resolve();
    // 新编辑替代尚未编码成功的旧候选；错误标记等新候选编码成功后再清除。
    encodingFailures.delete(key);
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
            for (const [key, value] of encodingFailures) scheduleStateSave(key, value);
            for (const key of [...scheduled.keys()]) startScheduled(key);
            await Promise.allSettled([...writes]);
            if (encodingFailures.size) throw new Error("画布内容编码失败，编辑仍保留在当前页面，请重试保存。");
            const reconnectOnce = async () => {
                if (isConflict(app)) throw new Error("存在版本冲突，不能通过重新连接覆盖。");
                if (typeof window.__guanSQLiteHost?.reconnect !== "function") throw new Error("保留页面重新连接协议不可用。");
                const codes = failureCodes(app);
                const denied = codes.has("session_denied");
                const authorizationResponseLost = codes.has("authorization_connection_failed");
                reconnecting = true; statusChanged();
                try {
                    await window.__guanSQLiteHost.reconnect(
                        denied
                            ? { reason: "session_denied" }
                            : authorizationResponseLost
                                ? { reason: "authorization_connection_failed" }
                                : undefined,
                    );
                }
                catch (error) {
                    // 服务端已完成恢复但响应在传输途中丢失时，下一次相同 reconnect
                    // 会返回原会话；reconnect_not_due 也只表示当前会话仍有效。
                    // 两者都不应阻止随后用原 operationId 重试保存。
                    const code = (error as { code?: unknown } | null)?.code;
                    if (code === "reconnect_not_due") return;
                    reconnectError = typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : "connection_failed";
                    throw error;
                }
            };
            if (reconnect) await reconnectOnce();
            try { await app.retryPending(); }
            catch (error) {
                // 一次点击内完成“先重试原操作、再恢复会话、再重试原操作”；
                // 只对服务明确报告会话失效的结果恢复，不把普通网络丢包当成可重连授权。
                if (!reconnect && needsSessionRecovery(app, error) && !AUTHORIZATION_END_ERRORS.has((error as { code?: string } | null)?.code ?? "")) {
                    await reconnectOnce();
                    await app.retryPending();
                } else throw error;
            }
            // 重试期间用户仍可能编辑；这些新操作也必须收到ACK，不能只清掉旧错误。
            for (const key of [...scheduled.keys()]) startScheduled(key);
            await Promise.allSettled([...writes]); await app.flush();
            if (writes.size || scheduled.size || encodingFailures.size || app.getStatus().state === "error" || app.getStatus().pending) throw new Error("仍有未确认编辑，请勿关闭或刷新。");
            failed.clear(); reconnectError = null;
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
