import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

type SavedFields = Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">;

// 恢复媒体、layout-effect检查点和视区还原可能创建等值对象。
// 只复用确认等值的普通数据引用；Blob/类实例/过深结构均保守视为变化。
export function sameCanvasValue(a: unknown, b: unknown, depth = 0, seen = new WeakMap<object, object>()): boolean {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || depth > 40) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && a.length !== (b as unknown[]).length) return false;
    if (!Array.isArray(a) && (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype)) return false;
    if (seen.has(a)) return seen.get(a) === b;
    seen.set(a, b);
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key)
        && sameCanvasValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth + 1, seen));
}

export function retainCanvasReferences(current: SavedFields | undefined, patch: Partial<SavedFields>): Partial<SavedFields> {
    if (!current) return patch;
    return Object.fromEntries(Object.entries(patch).map(([key, value]) => [key,
        sameCanvasValue(current[key as keyof SavedFields], value) ? current[key as keyof SavedFields] : value])) as Partial<SavedFields>;
}

export function canvasHasPendingChanges(current: SavedFields | undefined, patch: Partial<SavedFields>): boolean {
    return !current || Object.entries(patch).some(([key, value]) => !sameCanvasValue(current[key as keyof SavedFields], value));
}
