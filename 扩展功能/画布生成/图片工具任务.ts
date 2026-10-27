import { useCallback, type RefObject } from "react";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { requestCanvasImage, type CanvasImageTask } from "./原画布图片调用";
import type { useCanvasImageResults } from "../媒体交付/图片结果保存操作";

export function useCanvasImageTools({ projectId, nodesRef, recordTask, saveResult }: {
    projectId: string; nodesRef: RefObject<CanvasNodeData[]>;
    recordTask(id: string, task: CanvasImageTask): Promise<void>;
    saveResult: ReturnType<typeof useCanvasImageResults>;
}) {
    return useCallback(async (nodeId: string, config: AiConfig, prompt: string, references: ReferenceImage[], signal: AbortSignal, metadata: CanvasNodeMetadata) => {
        const node = nodesRef.current.find(item => item.id === nodeId);
        if (!node) throw Error("原图片结果卡片已删除，未发送生成请求。");
        await requestCanvasImage({ config, prompt, references, signal, scope: { productId: projectId, nodeId, slotId: nodeId },
            previous: node.metadata?.gatewayGenerationTasks?.find(task => task.slotId === nodeId),
            recordTask: task => recordTask(nodeId, task),
            applyAndSave: (image, receipt) => saveResult({ mode: "tool", nodeId, slotId: nodeId, image, receipt, signal,
                requestedSize: config.size, prompt, generationMetadata: metadata }),
        });
    }, [projectId, nodesRef, recordTask, saveResult]);
}
