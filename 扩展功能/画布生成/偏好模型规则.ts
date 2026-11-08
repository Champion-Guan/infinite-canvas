import type { CanvasNodeData } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";

const modelKeys = { image: "imageModel", video: "videoModel", text: "textModel", audio: "audioModel" } as const;
export type PreferredModels = Partial<Record<keyof typeof modelKeys, string>>;
type Preferences = Pick<AiConfig, typeof modelKeys[keyof typeof modelKeys]>;

export function changedPreferredModels(before: Preferences, after: Preferences): PreferredModels {
    return Object.fromEntries(Object.entries(modelKeys).flatMap(([mode, key]) =>
        after[key]?.trim() && before[key] !== after[key] ? [[mode, after[key]]] : []));
}

export function applyPreferredModels(nodes: CanvasNodeData[], models: PreferredModels) {
    let changed = false;
    const next = nodes.map(node => {
        if (node.type !== "config") return node;
        const model = models[node.metadata?.generationMode || "image"];
        if (!model || node.metadata?.model === model) return node;
        changed = true;
        return { ...node, metadata: { ...node.metadata, model } };
    });
    return changed ? next : nodes;
}

type Project = { id: string; nodes: CanvasNodeData[]; updatedAt: string };
type MountedCanvas = { getNodes(): CanvasNodeData[]; setNodes(nodes: CanvasNodeData[]): void };

export function createPreferredModelCoordinator() {
    const mounted = new Map<string, MountedCanvas>();
    return {
        register(projectId: string, canvas: MountedCanvas) {
            mounted.set(projectId, canvas);
            return () => { if (mounted.get(projectId) === canvas) mounted.delete(projectId); };
        },
        apply<T extends Project>(projects: T[], models: PreferredModels): T[] {
            for (const canvas of mounted.values()) {
                const previous = canvas.getNodes(), next = applyPreferredModels(previous, models);
                if (next !== previous) canvas.setNodes(next);
            }
            let changed = false;
            const next = projects.map(project => {
                // 已挂载画布通过原节点事务保存，不能拿旧存档覆盖页面中尚未保存的编辑。
                if (mounted.has(project.id)) return project;
                const nodes = applyPreferredModels(project.nodes, models);
                if (nodes === project.nodes) return project;
                changed = true;
                return { ...project, nodes, updatedAt: new Date().toISOString() };
            });
            return changed ? next : projects;
        },
    };
}
