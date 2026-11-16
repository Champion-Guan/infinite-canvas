const localTaskFields = new Set([
    "gatewayGenerationTasks", "gatewayGenerationReceipts", "productPlanningTaskSources",
    "videoTaskId", "videoTaskProvider", "videoTaskStatus", "videoTaskStartedAt",
]);

// 导入的是可编辑结果快照；来源电脑的任务身份不能在接收电脑恢复、确认或取消。
export function portableTaskSnapshot<T>(value: T): T {
    const visit = (item: unknown): unknown => {
        if (Array.isArray(item)) return item.map(visit);
        if (!item || typeof item !== "object") return item;
        const record = item as Record<string, unknown>;
        const archived = Object.fromEntries(Object.entries(record).filter(([key]) =>
            localTaskFields.has(key) || key === "productPlanningTask" || key === "productPlanningResolution"));
        const result = Object.fromEntries(Object.entries(record)
            .filter(([key]) => !localTaskFields.has(key))
            .map(([key, entry]) => {
                if (key === "importedTaskHistory") return [key, entry];
                if (key === "productPlanningTask") return [key, undefined];
                if (key === "productPlanningResolution") return [key, undefined];
                if (key === "status" && entry === "loading") return [key, "idle"];
                return [key, visit(entry)];
            }));
        if (Object.keys(archived).length) result.importedTaskHistory = { ...(record.importedTaskHistory as object || {}), ...archived };
        return result;
    };
    return visit(value) as T;
}
