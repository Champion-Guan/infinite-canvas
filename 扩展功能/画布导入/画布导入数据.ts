import { nanoid } from "nanoid";
import type { CanvasExportFile } from "@/types/canvas-export";

const storageFields = new Set(["storageKey", "originalStorageKey", "deliveryStorageKey", "references"]);

// Validate the entire package before writing files. Imported media always gets new keys.
export function prepareCanvasExport(data: unknown, zip: Map<string, Blob>, missingMedia: ReadonlyMap<string, string> = new Map()) {
    const document = data as Partial<CanvasExportFile> | null;
    if (!document || document.app !== "infinite-canvas" || document.version !== 3 || !Array.isArray(document.projects) || !document.projects.length) throw new Error("请选择有效的画布 ZIP 文件");
    const media: Array<{ key: string; blob: Blob }> = [];
    const projects = document.projects.map((item) => {
        const project = item?.project;
        if (!project || typeof project.title !== "string" || !Array.isArray(project.nodes) || !Array.isArray(project.connections) || !Array.isArray(item.files)) throw new Error("画布 ZIP 格式不完整");
        if (project.viewport && (![project.viewport.x, project.viewport.y, project.viewport.k].every(Number.isFinite) || project.viewport.k <= 0)) throw new Error("画布视区格式无效");
        const dates: Record<string, string> = {};
        for (const field of ["createdAt", "updatedAt"] as const) {
            const value: unknown = project[field];
            if (value === undefined || value === null) continue;
            if (typeof value !== "string" && typeof value !== "number" || !Number.isFinite(new Date(value).getTime())) throw new Error("画布时间格式无效");
            dates[field] = new Date(value).toISOString();
        }
        const ids = new Set<string>();
        for (const node of project.nodes) {
            if (!node || typeof node.id !== "string" || ids.has(node.id) || typeof node.type !== "string" || !node.position || ![node.position.x, node.position.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0) throw new Error("画布包含无效或重复卡片");
            ids.add(node.id);
        }
        if (project.connections.some((line) => !line || !ids.has(line.fromNodeId) || !ids.has(line.toNodeId))) throw new Error("连线引用了不存在的卡片");
        const keys = new Map<string, string>();
        const files = item.files.map((file) => {
            if (!file || typeof file.storageKey !== "string" || !/^(image|video|audio|file):/.test(file.storageKey) || keys.has(file.storageKey) || typeof file.path !== "string" || typeof file.mimeType !== "string") throw new Error("画布媒体清单无效");
            const blob = zip.get(file.path);
            if (!blob || blob.size !== file.bytes) throw new Error(`画布媒体缺失或大小不匹配：${file.path}`);
            const storageKey = `${file.storageKey.split(":")[0]}:${nanoid()}`;
            keys.set(file.storageKey, storageKey);
            media.push({ key: storageKey, blob: blob.slice(0, blob.size, file.mimeType) });
            return { ...file, storageKey };
        });
        const remap = (value: unknown, field = ""): unknown => {
            if (typeof value === "string" && storageFields.has(field) && /^(image|video|audio|file):/.test(value)) {
                const key = keys.get(value);
                if (!key) {
                    const missing = missingMedia.get(value);
                    if (missing) return missing;
                    throw new Error("画布引用的媒体未包含在 ZIP 中");
                }
                return key;
            }
            if (Array.isArray(value)) return value.map((entry) => remap(entry, field));
            if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, remap(entry, key)]));
            return value;
        };
        return { project: { ...remap(project) as typeof project, ...dates }, files };
    });
    return { projects, media };
}
