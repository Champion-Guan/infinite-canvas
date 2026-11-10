import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import type { MessageInstance } from "antd/es/message/interface";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { buildGenerationConfig, isGenerationCanceled } from "@/lib/canvas/canvas-generation-helpers";
import { buildImageGenerationMetadata } from "@/lib/canvas/canvas-node-factory";
import { ensureModelConfigured } from "../产品配置/模型配置门禁";
import { productCanvasResidency } from "../产品/画布驻留保护";
import { buildImageSuperPrompt, imageSuperActions, type ImageSuperAction } from "./一键超人规则";
import type { useCanvasImageTools } from "./图片工具任务";
import type { useCanvasGenerationRequests } from "./并发生成状态";
import { parseDeliverySize } from "../媒体交付/生成图片尺寸交付.mjs";

type Port = {
    projectId: string;
    nodesRef: RefObject<CanvasNodeData[]>;
    surfaceRef: RefObject<{ projectId: string; mounted: boolean; active: boolean }>;
    effectiveConfig: AiConfig;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    requestImageTool: ReturnType<typeof useCanvasImageTools>;
    startGenerationRequest: ReturnType<typeof useCanvasGenerationRequests>["startGenerationRequest"];
    finishGenerationRequest: ReturnType<typeof useCanvasGenerationRequests>["finishGenerationRequest"];
    message: MessageInstance;
};

export function useImageSuperGeneration(port: Port) {
    return useCallback((requested: CanvasNodeData, action: ImageSuperAction, input: string): boolean => {
        const { projectId, nodesRef, surfaceRef, effectiveConfig, setNodes, setConnections, setSelectedNodeIds,
            setSelectedConnectionId, requestImageTool, startGenerationRequest, finishGenerationRequest, message } = port;
        const surface = surfaceRef.current;
        const node = nodesRef.current.find(item => item.id === requested.id);
        if (!surface.mounted || !surface.active || surface.projectId !== projectId) return false;
        if (node?.type !== CanvasNodeType.Image || !node.metadata?.content) {
            message.warning("当前图片已不可用，请重新选择图片");
            return false;
        }
        let prompt: string;
        try { prompt = buildImageSuperPrompt(action, input); }
        catch (error) { message.warning(error instanceof Error ? error.message : "请检查编辑要求"); return false; }
        const width = node.metadata.deliveryWidth || node.metadata.naturalWidth;
        const height = node.metadata.deliveryHeight || node.metadata.naturalHeight;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !width || !height) {
            message.warning("无法读取原图像素尺寸，请重新载入图片后再试");
            return false;
        }
        const sourceSize = `${width}x${height}`;
        try { parseDeliverySize(sourceSize); }
        catch (error) { message.warning(error instanceof Error ? error.message : "原图尺寸不可用"); return false; }
        prompt += `\n输出图片必须保持原图的像素宽高：${width} × ${height} px。保持原图宽高比与完整构图，不改为正方形，不裁切或拉伸主体。`;
        const config = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: sourceSize };
        if (!ensureModelConfigured(config, "image", config.model)) return false;
        const id = nanoid();
        const references = [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }];
        const metadata = { ...buildImageGenerationMetadata("edit", config, 1, references), imageSuperSourceSize: sourceSize };
        const label = imageSuperActions.find(item => item.key === action)!.label;
        setNodes(current => [...current, {
            id, type: CanvasNodeType.Image, title: `${label} · ${node.title || "图片"}`,
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width: node.width, height: node.height,
            metadata: { ...metadata, prompt, status: "loading", generationStartedAt: Date.now() },
        }]);
        setConnections(current => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: id }]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        const controller = startGenerationRequest(id, node.id, id);
        void productCanvasResidency.run(projectId, async () => {
            try {
                await requestImageTool(id, config, prompt, references, controller.signal, metadata);
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "图片生成失败，请重试";
                message.error(errorDetails);
                setNodes(current => current.map(item => item.id === id
                    ? { ...item, metadata: { ...item.metadata, status: "error", errorDetails } } : item));
            } finally {
                finishGenerationRequest(id, controller);
            }
        });
        return true;
    }, [port]);
}
