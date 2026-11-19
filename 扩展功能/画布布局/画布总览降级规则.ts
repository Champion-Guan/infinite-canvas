import type { CanvasNodeData } from "@/types/canvas";

export function shouldUseCanvasOverview(viewportScale: number) {
    return Number.isFinite(viewportScale) && viewportScale <= 0.08;
}

export function isCanvasInteractionShellScale(viewportScale: number) {
    return Number.isFinite(viewportScale) && viewportScale <= 0.15;
}

export function canvasInteractionBudget(device: { hardwareConcurrency?: number; deviceMemory?: number } = {}) {
    const cores = Math.min(12, Math.max(2, device.hardwareConcurrency || 4));
    const memory = Math.min(8, Math.max(2, device.deviceMemory || 4));
    return 300 + cores * 15 + memory * 15;
}

export function canvasComplexityScore({ nodeCount, imageCount, connectionCount }: {
    nodeCount: number; imageCount: number; connectionCount: number;
}) {
    return Math.max(0, nodeCount) * 3 + Math.max(0, imageCount) * 1.5 + Math.max(0, connectionCount) * 0.75;
}

export function shouldUseCanvasInteractionShell(scale: number, score = Number.POSITIVE_INFINITY, budget = 0, learned = false) {
    return isCanvasInteractionShellScale(scale) && (score > budget || (learned && score >= 120));
}

export function createCanvasFramePressure() {
    let previous: number | undefined;
    let recent = 0;
    return (time: number) => {
        if (previous === undefined) { previous = time; return false; }
        const gap = time - previous;
        previous = time;
        recent = ((recent << 1) | Number(gap >= 40)) & 7;
        return recent === 3 || recent === 5 || recent === 6 || recent === 7;
    };
}

export function shouldFreezeCanvasNodeContent({
    isInteracting,
    complexityScore,
    nodeCount,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    referenceSelectionState,
    showPanel,
    isEditing,
}: {
    isInteracting: boolean;
    complexityScore?: number;
    nodeCount?: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    referenceSelectionState?: string;
    showPanel: boolean;
    isEditing: boolean;
}) {
    const score = complexityScore ?? Math.max(0, nodeCount ?? 0) * 3;
    return isInteracting && score > canvasInteractionBudget()
        && !isSelected && !isRelated && !isFocusRelated && !isConnectionTarget
        && !isConnecting && !referenceSelectionState && !showPanel && !isEditing;
}

export function canReuseCanvasNodeDuringZoom(previousScale: number, nextScale: number, wasInteracting: boolean, isInteracting: boolean) {
    return wasInteracting && isInteracting
        && shouldUseCanvasOverview(previousScale) === shouldUseCanvasOverview(nextScale);
}

export function shouldRenderCanvasNodeOverview({
    scale,
    node,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    referenceSelectionState,
    showPanel,
    isEditing,
    batchExpanded,
}: {
    scale: number;
    node: CanvasNodeData;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    referenceSelectionState?: "target" | "disabled" | "available";
    showPanel: boolean;
    isEditing: boolean;
    batchExpanded: boolean;
}) {
    return shouldUseCanvasOverview(scale)
        && !isSelected
        && !isRelated
        && !isFocusRelated
        && !isConnectionTarget
        && !isConnecting
        && !referenceSelectionState
        && !showPanel
        && !isEditing
        && !batchExpanded
        && node.type === "image";
}
