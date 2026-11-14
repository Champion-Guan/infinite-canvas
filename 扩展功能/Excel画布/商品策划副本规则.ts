import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

const planningRuntimeKeys = [
    "productPlanningTask", "productPlanningCandidate", "productPlanningPendingCommit",
    "productPlanningTaskSources", "productPlanningResolution", "productPlanningTaskOwner",
] as const;
type PlanningCopyMetadata = CanvasNodeMetadata & Partial<Record<typeof planningRuntimeKeys[number], unknown>> & {
    productPlanningTaskOwner?: { nodeId: string; productId: string; taskId: string };
    generationNotificationCopy?: boolean;
};

// 副本保留商品资料和已完成方案，只清理属于原卡的策划运行身份。
export function copiedProductPlanningPatch(): CanvasNodeMetadata {
    return Object.fromEntries(planningRuntimeKeys.map(key => [key, undefined]));
}

export function inheritedProductPlanningPatch(node: CanvasNodeData, productId: string): CanvasNodeMetadata | undefined {
    const metadata = node.metadata as PlanningCopyMetadata | undefined;
    if (!metadata) return;
    const owner = metadata.productPlanningTaskOwner;
    const task = metadata.productPlanningTask as { productId?: string; nodeId?: string } | undefined;
    const foreign = owner && (owner.nodeId !== node.id || owner.productId !== productId)
        || task && (task.productId && task.productId !== productId || task.nodeId && task.nodeId !== node.id);
    // 旧复制入口已清掉任务ID，但漏掉待保存等状态。只处理已标记的副本，不清理原卡待确认保存。
    const orphanCopy = metadata.generationNotificationCopy === true && !owner
        && !metadata.gatewayGenerationTasks?.length && !metadata.gatewayGenerationReceipts?.length
        && ["productPlanningCandidate", "productPlanningPendingCommit", "productPlanningTaskSources", "productPlanningResolution"]
            .some(key => metadata[key as keyof PlanningCopyMetadata] !== undefined);
    if (!foreign && !orphanCopy) return;
    return { ...copiedProductPlanningPatch(),
        ...(foreign ? { gatewayGenerationTasks: undefined, gatewayGenerationReceipts: undefined } : {}),
    };
}
