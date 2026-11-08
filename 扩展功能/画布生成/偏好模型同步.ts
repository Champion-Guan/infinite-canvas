import { useLayoutEffect, type RefObject } from "react";
import type { CanvasNodeData } from "@/types/canvas";
import { useConfigStore } from "@/stores/use-config-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { changedPreferredModels, createPreferredModelCoordinator } from "./偏好模型规则";

const coordinator = createPreferredModelCoordinator();

export function usePreferredModelSynchronization() {
    useLayoutEffect(() => useConfigStore.subscribe((state, previous) => {
        const models = changedPreferredModels(previous.config, state.config);
        if (!Object.keys(models).length) return;
        const canvas = useCanvasStore.getState();
        if (!canvas.hydrated) return;
        const projects = coordinator.apply(canvas.projects, models);
        if (projects !== canvas.projects) useCanvasStore.setState({ projects });
    }), []);
}

export function useCanvasPreferredModels({ projectId, ready, nodesRef, setNodes }: {
    projectId: string; ready: boolean; nodesRef: RefObject<CanvasNodeData[]>; setNodes(nodes: CanvasNodeData[]): void;
}) {
    useLayoutEffect(() => {
        if (!ready) return;
        return coordinator.register(projectId, { getNodes: () => nodesRef.current, setNodes });
    }, [projectId, ready, nodesRef, setNodes]);
}
