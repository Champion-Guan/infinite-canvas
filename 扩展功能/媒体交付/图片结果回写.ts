// 图片落盘后的节点回写规则；不发请求、不保存画布、不改变稳定命名。
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import type { UploadedImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeMetadata } from "@/types/canvas";
import { resizedResultPosition } from "../画布布局/批量结果排布";
import type { CanvasImageReceipt } from "../画布生成/原画布图片调用";

export type ImageResult = {
    slotId: string;
    uploaded: UploadedImage;
    receipt: CanvasImageReceipt;
    requestedSize?: string;
    upstreamSize?: string;
};

function storedImageFields(image: UploadedImage) {
    return {
        content: image.url, storageKey: image.storageKey,
        naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType,
        deliveryStorageKey: image.deliveryStorageKey, originalStorageKey: image.originalStorageKey,
        originalWidth: image.originalWidth, originalHeight: image.originalHeight, originalBytes: image.originalBytes, originalMimeType: image.originalMimeType,
        deliveryWidth: image.deliveryWidth, deliveryHeight: image.deliveryHeight, deliveryBytes: image.deliveryBytes, deliveryMimeType: image.deliveryMimeType,
    };
}

function resultImages(node: CanvasNodeData, result: ImageResult) {
    const image: CanvasNodeImage = { id: result.slotId, status: "success", ...storedImageFields(result.uploaded) };
    return node.metadata?.images?.map(current => current.id === image.id ? { ...current, ...image, errorDetails: undefined } : current);
}

function resultReceipts(node: CanvasNodeData, receipt: CanvasImageReceipt) {
    return [...(node.metadata?.gatewayGenerationReceipts || []).filter(current => current.taskId !== receipt.taskId), receipt];
}

function deliveryDetails(result: ImageResult) {
    return { requestedSize: result.requestedSize, upstreamSize: result.upstreamSize, deliverySize: `${result.uploaded.width}x${result.uploaded.height}` };
}

export function applyBatchImageResult(node: CanvasNodeData, result: ImageResult): CanvasNodeData {
    const metadata = {
        ...node.metadata, images: resultImages(node, result) || [], status: "success" as const,
        errorDetails: undefined, gatewayGenerationReceipts: resultReceipts(node, result.receipt),
    };
    // 并发返回的后续图片只更新所属槽位，第一张成功图片继续作为主图。
    if (node.metadata?.primaryImageId) return { ...node, metadata };
    const bounds = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = fitNodeSize(result.uploaded.width, result.uploaded.height, bounds.width, bounds.height);
    return {
        ...node, ...size,
        position: resizedResultPosition(node, size),
        metadata: { ...metadata, ...storedImageFields(result.uploaded), ...deliveryDetails(result), primaryImageId: result.slotId },
    };
}

export function applyRetriedImageResult(node: CanvasNodeData, result: ImageResult, options: {
    imageId?: string;
    prompt: string;
    generationMetadata: CanvasNodeMetadata;
}): CanvasNodeData {
    const makePrimary = !options.imageId || !node.metadata?.content;
    const edge = options.imageId ? Math.max(node.width, node.height) : 0;
    const bounds = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = options.imageId && node.metadata?.freeResize ? { width: node.width, height: node.height }
        : options.imageId ? fitNodeSize(result.uploaded.width, result.uploaded.height, edge, edge)
        : fitNodeSize(result.uploaded.width, result.uploaded.height, bounds.width, bounds.height);
    return {
        ...node, type: CanvasNodeType.Image,
        ...(makePrimary ? { ...size, ...(options.imageId ? { position: resizedResultPosition(node, size) } : {}) } : {}),
        metadata: {
            ...node.metadata,
            gatewayGenerationReceipts: resultReceipts(node, result.receipt),
            ...(makePrimary ? imageMetadata(result.uploaded, deliveryDetails(result)) : { status: "success" as const }),
            errorDetails: undefined, images: resultImages(node, result),
            primaryImageId: makePrimary ? result.slotId : node.metadata?.primaryImageId,
            prompt: options.prompt, ...options.generationMetadata,
        },
    };
}

export function applyToolImageResult(node: CanvasNodeData, result: ImageResult, options: { prompt: string; generationMetadata: CanvasNodeMetadata }): CanvasNodeData {
    const size = fitNodeSize(result.uploaded.width, result.uploaded.height, node.width, node.height);
    return { ...node, ...size, metadata: { ...node.metadata, ...options.generationMetadata,
        ...imageMetadata(result.uploaded, deliveryDetails(result)), prompt: options.prompt,
        errorDetails: undefined, gatewayGenerationReceipts: resultReceipts(node, result.receipt),
    } };
}
