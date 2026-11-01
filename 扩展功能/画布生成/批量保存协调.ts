// 一键执行批量生成时只保留内存中的最新画布，整批结束后再提交一次。
// 这是页内临时状态，不写入画布，也不改变任务账本和媒体落盘协议。
type BatchSaveScope = { depth: number; dirty: boolean; persistAllowance: number };
export type BatchCanvasSaveOutcome = "saved" | "not-saved" | "failed";

const scopes = new Map<string, BatchSaveScope>();
const completionWaiters = new Map<string, Set<(outcome: BatchCanvasSaveOutcome) => void>>();

export function beginBatchCanvasSave(projectId: string) {
    if (!projectId) throw new Error("批量保存需要产品标识。");
    const current = scopes.get(projectId);
    if (current) current.depth++;
    else scopes.set(projectId, { depth: 1, dirty: false, persistAllowance: 0 });
}

export function markBatchCanvasDirty(projectId: string) {
    const scope = scopes.get(projectId);
    if (!scope) return false;
    scope.dirty = true;
    return true;
}

export function isBatchCanvasSaveActive(projectId: string) {
    return scopes.has(projectId);
}

// 任务确认可等待批量最终快照的真实 ACK；不轮询，也不把门控中的空返回当作持久化。
export function waitForBatchCanvasSave(projectId: string): Promise<BatchCanvasSaveOutcome> | null {
    if (!scopes.has(projectId)) return null;
    return new Promise(resolve => {
        const waiters = completionWaiters.get(projectId) || new Set();
        waiters.add(resolve);
        completionWaiters.set(projectId, waiters);
    });
}

// 批量结束时只放行当前产品的一次完整 Zustand 快照。
export async function withBatchCanvasCheckpoint<T>(projectId: string, callback: () => Promise<T>): Promise<T> {
    const scope = scopes.get(projectId);
    if (!scope) return callback();
    const previousAllowance = scope.persistAllowance;
    scope.persistAllowance++;
    try {
        return await callback();
    } finally {
        // shouldDeferCanvasPersist 消耗已用掉的票据；清理没有被消费的票据。
        if (scope.persistAllowance > previousAllowance) scope.persistAllowance--;
    }
}

export function shouldDeferCanvasPersist(projects: ReadonlyArray<{ id: string }>) {
    let deferred = false;
    for (const project of projects) {
        const scope = scopes.get(project.id);
        if (!scope) continue;
        if (scope.persistAllowance > 0) {
            scope.persistAllowance--;
            continue;
        }
        scope.dirty = true;
        deferred = true;
    }
    return deferred;
}

export function finishBatchCanvasSave(projectId: string): boolean | null {
    const scope = scopes.get(projectId);
    if (!scope) return false;
    scope.depth--;
    if (scope.depth > 0) return null;
    return scope.dirty;
}

export function completeBatchCanvasSave(projectId: string, outcome: BatchCanvasSaveOutcome = "not-saved") {
    const scope = scopes.get(projectId);
    // 批量入口可以嵌套（例如“一键补齐并执行”会再调用
    // “执行全部配置卡片”）。内层收尾不能提前释放外层门控，
    // 否则后续节点更新会绕过批量保存，重新触发整画布写入。
    if (!scope || scope.depth > 0) return;
    scopes.delete(projectId);
    const waiters = completionWaiters.get(projectId);
    if (waiters) {
        completionWaiters.delete(projectId);
        for (const resolve of waiters) resolve(outcome);
    }
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("guan:batch-save-complete", { detail: { projectId, outcome } }));
    }
}
