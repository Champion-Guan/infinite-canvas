import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasGenerationRequest } from "./并发生成状态";
import { imageSizeRetryBlocked } from "../媒体交付/生成图片尺寸交付.mjs";

export function imageRetryKey(nodeId: string, imageId?: string): string {
    return JSON.stringify([nodeId, imageId || null]);
}

// 整卡请求独占节点；图片槽位只独占自身，兄弟槽位不互相中止或覆盖登记。
export function canRetryCanvasNode(node: CanvasNodeData | undefined, imageId: string | undefined,
    retries: ReadonlySet<string>, requests: ReadonlyMap<string, CanvasGenerationRequest>, ownKey?: string): boolean {
    if (!node) return false;
    const slot = node.type === "image" && imageId ? node.metadata?.images?.find(image => image.id === imageId) : undefined;
    if (imageId && !slot) return false;
    if (slot ? imageSizeRetryBlocked(slot) : imageSizeRetryBlocked(node.metadata)
        || node.metadata?.images?.some(image => image.status === "error" && imageSizeRetryBlocked(image))) return false;
    const key = imageRetryKey(node.id, imageId);
    if (key !== ownKey && retries.has(key)) return false;
    if (retries.has(imageRetryKey(node.id)) && key !== imageRetryKey(node.id)) return false;
    if (requests.has(node.id)) return false;
    if (slot) return slot.status !== "loading" && !requests.has(key)
        && !(node.metadata?.status === "loading" && !node.metadata.images?.some(image => image.status === "loading"));
    return ![...retries].some(value => value !== ownKey && JSON.parse(value)[0] === node.id)
        && ![...requests.values()].some(request => request.targetNodeId === node.id)
        && node.metadata?.status !== "loading" && !node.metadata?.images?.some(image => image.status === "loading");
}

export function settleImageRetryStatus(node: CanvasNodeData): CanvasNodeData {
    const images = node.metadata?.images || [];
    const status = images.some(image => image.status === "loading") ? "loading"
        : node.metadata?.content || images.some(image => image.status === "success") ? "success" : "error";
    if (node.metadata?.status === status) return node;
    return { ...node, metadata: { ...node.metadata, status, ...(status === "loading" || status === "success" ? { errorDetails: undefined } : {}) } };
}
