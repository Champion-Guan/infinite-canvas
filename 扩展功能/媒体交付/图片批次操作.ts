// 批次选择、复制和删除共用原节点事务；素材文件由原存储生命周期管理。
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage } from "@/types/canvas";
import { generatedImageName } from "./生成图片命名";

// 显式写入可选字段，避免沿用上一张图的原图/交付图信息。
function imageFields(image?: CanvasNodeImage) {
    return {
        content: image?.content || "", storageKey: image?.deliveryStorageKey || image?.storageKey,
        naturalWidth: image?.naturalWidth, naturalHeight: image?.naturalHeight, bytes: image?.bytes, mimeType: image?.mimeType,
        deliveryStorageKey: image?.deliveryStorageKey, originalStorageKey: image?.originalStorageKey,
        originalWidth: image?.originalWidth, originalHeight: image?.originalHeight, originalBytes: image?.originalBytes, originalMimeType: image?.originalMimeType,
        deliveryWidth: image?.deliveryWidth, deliveryHeight: image?.deliveryHeight, deliveryBytes: image?.deliveryBytes, deliveryMimeType: image?.deliveryMimeType,
        deliverySize: image?.content ? `${image.deliveryWidth || image.naturalWidth}x${image.deliveryHeight || image.naturalHeight}` : undefined,
        deliveryNote: image?.deliveryNote,
        requestedSize: image?.requestedSize,
        upstreamSize: image?.upstreamSize,
    };
}

function withPrimaryImage(node: CanvasNodeData, image: CanvasNodeImage): CanvasNodeData {
    const edge = Math.max(node.width, node.height);
    const size = node.metadata?.freeResize ? { width: node.width, height: node.height } : fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
    return {
        ...node, ...size,
        position: { x: node.position.x + (node.width - size.width) / 2, y: node.position.y + (node.height - size.height) / 2 },
        metadata: { ...node.metadata, ...imageFields(image), primaryImageId: image.id, status: "success", errorDetails: undefined },
    };
}

export function selectBatchPrimary(node: CanvasNodeData, itemId: string): CanvasNodeData {
    if (node.type === CanvasNodeType.Text) {
        const text = node.metadata?.texts?.find(item => item.id === itemId);
        return text?.content && (node.metadata?.primaryTextId !== itemId || node.metadata.content !== text.content)
            ? { ...node, metadata: { ...node.metadata, content: text.content, primaryTextId: itemId } } : node;
    }
    if (node.type !== CanvasNodeType.Image) return node;
    const image = node.metadata?.images?.find(item => item.id === itemId);
    return image?.content ? withPrimaryImage(node, image) : node;
}

export function copyBatchImage(node: CanvasNodeData, imageId: string, id: string): CanvasNodeData | null {
    if (node.type !== CanvasNodeType.Image) return null;
    const image = node.metadata?.images?.find(item => item.id === imageId);
    if (!image?.content) return null;
    const edge = Math.max(node.width, node.height);
    const size = fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
    const metadata = node.metadata;
    return {
        id, type: CanvasNodeType.Image, title: generatedImageName(node, imageId), ...size,
        position: { x: node.position.x + node.width * 2 + 96, y: node.position.y + (node.height - size.height) / 2 },
        metadata: {
            ...imageFields(image), status: "success", prompt: metadata?.prompt,
            generationType: metadata?.generationType, model: metadata?.model, size: metadata?.size,
            quality: metadata?.quality, background: metadata?.background, references: metadata?.references?.slice(),
            requestedSize: image.requestedSize || metadata?.requestedSize, upstreamSize: image.upstreamSize || metadata?.upstreamSize,
        },
    };
}

export function removeBatchImage(node: CanvasNodeData, imageId: string): CanvasNodeData {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.images?.some(image => image.id === imageId)) return node;
    const images = node.metadata.images.filter(image => image.id !== imageId);
    const next = { ...node, metadata: { ...node.metadata, images, count: images.length } };
    // 删除非主图不改变主图；没有有效主图的旧批次也在此修复。
    const current = images.find(image => image.id === node.metadata?.primaryImageId && image.content);
    if (current) return next;
    const primary = images.find(image => image.content);
    if (primary) return withPrimaryImage(next, primary);
    const loading = images.some(image => image.status === "loading");
    const failure = images.find(image => image.status === "error");
    return {
        ...next,
        metadata: { ...next.metadata, ...imageFields(), primaryImageId: undefined,
            status: loading ? "loading" : failure ? "error" : "idle", errorDetails: loading ? undefined : failure?.errorDetails },
    };
}

type Setter<T> = Dispatch<SetStateAction<T>>;
type BatchPort = {
    nodesRef: RefObject<CanvasNodeData[]>;
    setNodes: Setter<CanvasNodeData[]>;
    setExpandedBatchNodeIds: Setter<Set<string>>;
    setSelectedNodeIds: Setter<Set<string>>;
    setSelectedConnectionId: Setter<string | null>;
    setDialogNodeId: Setter<string | null>;
};

export function useCanvasImageBatches({ nodesRef, setNodes, setExpandedBatchNodeIds, setSelectedNodeIds, setSelectedConnectionId, setDialogNodeId }: BatchPort) {
    const setBatchPrimary = useCallback((nodeId: string, itemId: string) => {
        const node = nodesRef.current.find(item => item.id === nodeId);
        if (!node || selectBatchPrimary(node, itemId) === node) return;
        setNodes(previous => previous.map(item => item.id === nodeId ? selectBatchPrimary(item, itemId) : item));
    }, [nodesRef, setNodes]);

    const duplicateBatchImage = useCallback((eventNode: CanvasNodeData, imageId: string) => {
        // 迟到事件必须读取当前节点，不能把已删卡片或旧结果复制回来。
        const node = nodesRef.current.find(item => item.id === eventNode.id);
        if (!node) return;
        const copy = copyBatchImage(node, imageId, nanoid());
        if (!copy) return;
        setNodes(previous => [...previous, copy]);
        setSelectedNodeIds(new Set([copy.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(copy.id);
    }, [nodesRef, setNodes, setSelectedNodeIds, setSelectedConnectionId, setDialogNodeId]);

    const deleteBatchImage = useCallback((nodeId: string, imageId: string) => {
        const node = nodesRef.current.find(item => item.id === nodeId);
        if (!node || removeBatchImage(node, imageId) === node) return;
        if ((node.metadata?.images?.length || 0) <= 2) setExpandedBatchNodeIds(current => new Set([...current].filter(id => id !== nodeId)));
        setNodes(previous => previous.map(item => item.id === nodeId ? removeBatchImage(item, imageId) : item));
    }, [nodesRef, setNodes, setExpandedBatchNodeIds]);

    return { setBatchPrimary, duplicateBatchImage, deleteBatchImage };
}
