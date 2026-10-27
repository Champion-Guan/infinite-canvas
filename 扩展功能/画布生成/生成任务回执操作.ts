// 原画布任务账本与确认保存边界，不创建独立状态副本。
import { useCallback, useRef, type RefObject } from "react";
import type { CanvasNodeData } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import type { AiTextMessage } from "@/services/api/image";
import type { CanvasImageTask } from "./原画布图片调用";
import type { ConfirmedImageTarget } from "./图片任务确认状态";
import { requestCanvasText } from "./原画布文本调用";
import { clearConfirmedImageErrors } from "./图片任务确认恢复.mjs";
import { saveProductCanvas } from "../产品/产品操作";
import { requestCanvasAudio } from "./原画布音频调用";
import { storeGeneratedAudio } from "@/services/api/audio";
import type { UploadedFile } from "@/services/file-storage";

type TaskReceiptPort = {
    projectId: string;
    nodesRef: RefObject<CanvasNodeData[]>;
    restoredProjectIdRef: RefObject<string | null>;
    setNodes: (update: CanvasNodeData[] | ((previous: CanvasNodeData[]) => CanvasNodeData[])) => void;
};

export function useCanvasTaskReceipts({ projectId, nodesRef, restoredProjectIdRef, setNodes }: TaskReceiptPort) {
    const NODE_STATUS_SUCCESS = "success" as const;
    const pendingImageErrorSaves = useRef(new Set<string>());
    const clearConfirmedImageError = useCallback(async (target: ConfirmedImageTarget) => {
        if (target.productId !== projectId || restoredProjectIdRef.current !== projectId) return;
        const previous = nodesRef.current;
        const next = clearConfirmedImageErrors(previous, target) as CanvasNodeData[];
        if (next !== previous) {
            pendingImageErrorSaves.current.add(target.id);
            setNodes(next);
        }
        // 清理保存失败时保留重试标记；下次仅保存，不重新交付或生成图片。
        if (pendingImageErrorSaves.current.has(target.id)) {
            await saveProductCanvas(projectId);
            pendingImageErrorSaves.current.delete(target.id);
        }
    }, [projectId, setNodes, nodesRef, restoredProjectIdRef]);

    const recordImageGatewayTask = useCallback(async (id: string, task: CanvasImageTask) => {
        if (!nodesRef.current.some(node => node.id === id)) throw new Error("原结果卡片已删除，未发送生成请求。");
        setNodes(prev => prev.map(node => node.id !== id ? node : { ...node, metadata: {
            ...node.metadata, gatewayGenerationTasks: [...(node.metadata?.gatewayGenerationTasks || []).filter(item => item.slotId !== task.slotId), task],
        } }));
        await saveProductCanvas(projectId);
    }, [projectId, setNodes, nodesRef]);

    const requestNodeText = useCallback(async (config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options: { signal: AbortSignal; nodeId: string; slotId: string; retry?: boolean }) => {
        const current = nodesRef.current.find(node => node.id === options.nodeId);
        if (!current) throw Error("原文本卡片已删除，未发送生成请求");
        const assertTarget = (taskId?: string) => {
            options.signal.throwIfAborted();
            const node = nodesRef.current.find(item => item.id === options.nodeId);
            if (restoredProjectIdRef.current !== projectId || !node) throw Error("原文本画布或卡片已关闭，结果保留在任务账本");
            if (taskId && node.metadata?.gatewayGenerationTasks?.find(task => task.slotId === options.slotId)?.taskId !== taskId)
                throw Error("文本槽位已开始新任务，旧响应保留在任务账本");
        };
        assertTarget();
        return requestCanvasText({
            config, messages, signal: options.signal, retry: options.retry,
            scope: { productId: projectId, nodeId: options.nodeId, slotId: options.slotId },
            previous: current.metadata?.gatewayGenerationTasks?.find(task => task.slotId === options.slotId),
            recordTask: task => { assertTarget(); return recordImageGatewayTask(options.nodeId, task); },
            applyAndSave: async (text, receipt) => {
                assertTarget(receipt.taskId);
                onDelta(text);
                setNodes(prev => prev.map(node => node.id !== options.nodeId ? node : { ...node, metadata: {
                    ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined,
                    texts: node.metadata?.texts?.map(item => item.id !== options.slotId ? item : { ...item, content: text, status: NODE_STATUS_SUCCESS, errorDetails: undefined }),
                    gatewayGenerationReceipts: [...(node.metadata?.gatewayGenerationReceipts || []).filter(item => item.taskId !== receipt.taskId), receipt],
                } }));
                await saveProductCanvas(projectId);
            },
        });
    }, [projectId, recordImageGatewayTask, setNodes, nodesRef, restoredProjectIdRef]);

    const requestNodeAudio = useCallback(async (config: AiConfig, prompt: string, apply: (audio: UploadedFile) => void, options: { signal: AbortSignal; nodeId: string; slotId: string; retry?: boolean }) => {
        const current = nodesRef.current.find(node => node.id === options.nodeId);
        if (!current) throw Error("原音频卡片已删除，未发送生成请求。");
        const assertTarget = (taskId: string) => {
            options.signal.throwIfAborted();
            const node = nodesRef.current.find(node => node.id === options.nodeId);
            if (restoredProjectIdRef.current !== projectId || !node) throw Error("原音频画布或卡片已关闭，响应保留在任务账本。");
            if (node.metadata?.gatewayGenerationTasks?.find(task => task.slotId === options.slotId)?.taskId !== taskId) throw Error("音频槽位已开始新任务，旧响应保留在任务账本。");
        };
        await requestCanvasAudio({ config, prompt, signal: options.signal, retry: options.retry,
            scope: { productId: projectId, nodeId: options.nodeId, slotId: options.slotId },
            previous: current.metadata?.gatewayGenerationTasks?.find(task => task.slotId === options.slotId),
            recordTask: task => recordImageGatewayTask(options.nodeId, task),
            applyAndSave: async (blob, receipt) => {
                assertTarget(receipt.taskId);
                const audio = await storeGeneratedAudio(blob, config.audioFormat);
                assertTarget(receipt.taskId);
                apply(audio);
                setNodes(prev => prev.map(node => node.id !== options.nodeId ? node : { ...node, metadata: { ...node.metadata,
                    status: NODE_STATUS_SUCCESS, errorDetails: undefined,
                    gatewayGenerationReceipts: [...(node.metadata?.gatewayGenerationReceipts || []).filter(item => item.taskId !== receipt.taskId), receipt],
                } }));
                await saveProductCanvas(projectId);
            },
        });
    }, [projectId, recordImageGatewayTask, setNodes, nodesRef, restoredProjectIdRef]);

    return { clearConfirmedImageError, recordImageGatewayTask, requestNodeText, requestNodeAudio };
}
