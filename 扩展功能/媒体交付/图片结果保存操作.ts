// 首次生成和重试共用图片落盘、回写、保存边界；沿用原任务确认协议。
import { useCallback, type RefObject } from "react";
import { uploadImage } from "@/services/image-storage";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { GeneratedImage } from "../画布生成/原版图片协议";
import type { CanvasImageReceipt } from "../画布生成/原画布图片调用";
import { saveProductCanvas } from "../产品/产品操作";
import { applyBatchImageResult, applyRetriedImageResult, type ImageResult } from "./图片结果回写";

type ResultPort = {
    projectId: string;
    nodesRef: RefObject<CanvasNodeData[]>;
    restoredProjectIdRef: RefObject<string | null>;
    surfaceRef: RefObject<{ projectId: string; mounted: boolean }>;
    setNodes: (update: (previous: CanvasNodeData[]) => CanvasNodeData[]) => void;
};
type ResultRequest = {
    nodeId: string;
    slotId: string;
    image: GeneratedImage;
    receipt: CanvasImageReceipt;
    signal: AbortSignal;
    requestedSize?: string;
} & ({ mode: "batch"; sourceConfigId?: string; onApplied: () => void }
    | { mode: "retry"; imageId?: string; prompt: string; generationMetadata: CanvasNodeMetadata });

export function useCanvasImageResults({ projectId, nodesRef, restoredProjectIdRef, surfaceRef, setNodes }: ResultPort) {
    return useCallback(async (request: ResultRequest) => {
        const assertTarget = () => {
            if (request.signal.aborted) throw request.signal.reason || new DOMException("生成已取消", "AbortError");
            const surface = surfaceRef.current;
            // 隐藏的产品仍可完成原任务；只有关闭、身份改变或尚未恢复时才阻止回写。
            if (!surface.mounted || surface.projectId !== projectId || restoredProjectIdRef.current !== projectId)
                throw Error("原画布已关闭或切换，图片响应保留在任务账本。");
            const node = nodesRef.current.find(item => item.id === request.nodeId);
            if (!node || (request.mode === "batch" || request.imageId) && !node.metadata?.images?.some(item => item.id === request.slotId))
                throw Error("原结果卡片或图片槽位已删除，图片响应保留在任务账本。");
            const task = node.metadata?.gatewayGenerationTasks?.find(item => item.slotId === request.slotId);
            if (task && task.taskId !== request.receipt.taskId) throw Error("图片槽位已开始新任务，旧响应保留在任务账本。");
        };
        assertTarget();
        const uploaded = await uploadImage(request.image.dataUrl, { signal: request.signal });
        assertTarget();
        const result: ImageResult = {
            slotId: request.slotId, uploaded, receipt: request.receipt,
            requestedSize: request.image.deliverySize || request.requestedSize, upstreamSize: request.image.upstreamSize,
        };
        setNodes(previous => previous.map(node => {
            if (node.id === request.nodeId) return request.mode === "batch" ? applyBatchImageResult(node, result) : applyRetriedImageResult(node, result, request);
            if (request.mode === "batch" && node.id === request.sourceConfigId)
                return { ...node, metadata: { ...node.metadata, status: "success" as const, errorDetails: undefined } };
            return node;
        }));
        if (request.mode === "batch") request.onApplied();
        await saveProductCanvas(projectId);
    }, [projectId, nodesRef, restoredProjectIdRef, surfaceRef, setNodes]);
}
