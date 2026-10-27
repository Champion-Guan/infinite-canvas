// 仅保存当前激活画布的内存上下文；后台保留挂载的画布不能夺取上传归属。
let currentProjectId: string | undefined;
let activation: object | undefined;
export function activateAssetProject(projectId?: string) {
    const token = {};
    activation = token;
    currentProjectId = projectId || undefined;
    return () => { if (activation === token) { currentProjectId = undefined; activation = undefined; } };
}

export type UserUpload = { projectId?: string; name: string };
export function captureUserUpload(input: string | Blob, projectId = currentProjectId): UserUpload | null {
    if (typeof File === "undefined" || !(input instanceof File)) return null;
    return { projectId, name: input.name || "上传文件" };
}

type StoredAsset = { kind: string; metadata?: Record<string, unknown>; data: unknown };
export function sameStoredAsset(left: StoredAsset, right: StoredAsset) {
    if (left.kind === "text" || left.kind !== right.kind || left.metadata?.projectId !== right.metadata?.projectId) return false;
    const key = (data: unknown) => data && typeof data === "object" && "storageKey" in data ? data.storageKey : undefined;
    return Boolean(key(left.data)) && key(left.data) === key(right.data);
}

export const ASSET_DRAG_TYPE = "application/x-guan-canvas-asset";
export function assetDragData(assetId: string, projectId: string) {
    return JSON.stringify({ version: 1, assetId, projectId });
}
export function readAssetDrag(data: string, projectId: string): string | null {
    try {
        const value: unknown = JSON.parse(data);
        if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("projectId" in value) || value.projectId !== projectId || !("assetId" in value) || typeof value.assetId !== "string" || !value.assetId) return null;
        return value.assetId;
    } catch { return null; }
}
