// 批量配置补齐与执行队列；只调用传入的单节点生成入口。
import { useCallback, useRef, type RefObject, type Dispatch, type SetStateAction } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";
import type { useEffectiveConfig } from "@/stores/use-config-store";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { getNodeSpec } from "@/constant/canvas";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { getGenerationCount } from "@/lib/canvas/canvas-generation-helpers";
import { nanoid } from "nanoid";
import { promptGenerationPatch, generationSettingsFromNode } from "./生成参数继承";
import { promptGenerationMode } from "../安全与批量/prompt-generation-mode";
import { settleActivityGroup } from "../安全与批量/settle-activity-group";
import { placeCanvasNode } from "../画布布局/卡片自动避让";
import type { BatchResultPlacement } from "../画布布局/批量结果排布";
import { planProductGenerationJobs, productGenerationImageCount, type ProductGenerationJob } from "./产品变体生成";
import { beginBatchCanvasSave, completeBatchCanvasSave, finishBatchCanvasSave } from "./批量保存协调";
import { promptDocument, PRODUCT_IMAGE_MODEL, type ProductPromptMetadata } from "../Excel画布/商品提示词规则";
import { productImageConfig, productConfigSignature } from "../Excel画布/商品提示词画布";

type BatchGenerationPort = {
    projectId: string;
    nodesRef: RefObject<CanvasNodeData[]>;
    connectionsRef: RefObject<CanvasConnection[]>;
    effectiveConfig: ReturnType<typeof useEffectiveConfig>;
    setNodes: (update: CanvasNodeData[] | ((previous: CanvasNodeData[]) => CanvasNodeData[])) => void;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    handleGenerateNode: (id: string, mode: CanvasNodeGenerationMode, prompt: string, placement?: BatchResultPlacement) => Promise<unknown>;
    saveCanvas?: (id: string, options?: { force?: boolean }) => Promise<unknown>;
    message: MessageInstance;
};
export function useCanvasBatchGeneration({ projectId, nodesRef, connectionsRef, effectiveConfig, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, handleGenerateNode, saveCanvas = async () => {}, message }: BatchGenerationPort) {
    const NODE_STATUS_LOADING = "loading";
    const addGenerationConfigsForPromptNodes = useCallback(() => {
        const promptNodes = nodesRef.current.filter((node) => !(node.metadata as ProductPromptMetadata)?.productPromptRetired
            && (promptDocument(node) || node.type === CanvasNodeType.Text && Boolean((node.metadata?.content || node.metadata?.prompt || "").trim())));
        const connectedPromptIds = new Set(connectionsRef.current.map((connection) => connection.fromNodeId));
        const candidates = promptNodes.filter((node) => !connectedPromptIds.has(node.id));
        if (!candidates.length) {
            message.info("没有找到尚未连接生成配置的提示词卡片");
            return;
        }
        const configSpec = getNodeSpec(CanvasNodeType.Config);
        const occupied = [...nodesRef.current];
        const created: CanvasNodeData[] = [];
        const nextConnections = [...connectionsRef.current];
        candidates.forEach((sourceNode) => {
            const document = promptDocument(sourceNode);
            const mode = promptGenerationMode(sourceNode, nodesRef.current, connectionsRef.current) || "image";
            const x = sourceNode.position.x + sourceNode.width + 96;
            const y = sourceNode.position.y;
            const configNode = placeCanvasNode(createCanvasNode(CanvasNodeType.Config, { x: x + configSpec.width / 2, y: y + configSpec.height / 2 }, {
                prompt: "",
                model: effectiveConfig.imageModel || effectiveConfig.model,
                size: effectiveConfig.size,
                count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                // Excel prompt cards can contain image parameters in their
                // text rather than explicit metadata. Parse the same prompt
                // contract used by normal generation so the new config card
                // is a complete snapshot and does not fall back to globals.
                ...promptGenerationPatch(String(sourceNode.metadata?.content || sourceNode.metadata?.prompt || "")),
                ...generationSettingsFromNode(sourceNode),
                generationMode: mode,
                ...(mode !== "image" ? { model: mode === "video" ? effectiveConfig.videoModel : mode === "audio" ? effectiveConfig.audioModel : effectiveConfig.textModel } : {}),
                ...(document ? { ...productImageConfig(document, PRODUCT_IMAGE_MODEL), productPromptConfigKey: sourceNode.id } : {}),
            }), occupied);
            if (document) configNode.metadata = { ...configNode.metadata, productPromptConfigSignature: productConfigSignature(configNode) } as ProductPromptMetadata;
            created.push(configNode);
            occupied.push(configNode);
            nextConnections.push({ id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id });
        });
        const nextNodes = [...nodesRef.current, ...created];
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        setSelectedNodeIds(new Set(created.map((node) => node.id)));
        setSelectedConnectionId(null);
        message.success(`已补齐 ${created.length} 个生成配置`);
    }, [effectiveConfig.videoModel, effectiveConfig.audioModel, effectiveConfig.textModel, effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, setNodes, nodesRef, connectionsRef, setConnections, setSelectedNodeIds, setSelectedConnectionId]);

    const batchGenerationRunning = useRef(false);
    const generateAllConfigNodes = useCallback(async () => {
        if (batchGenerationRunning.current) return;
        const configNodes = nodesRef.current.filter((node) => node.type === CanvasNodeType.Config && node.metadata?.status !== NODE_STATUS_LOADING
            && !(node.metadata as ProductPromptMetadata)?.productPromptRetired);
        if (!configNodes.length) {
            message.info("画布上没有生成配置卡片");
            return;
        }
        let jobs: ProductGenerationJob[];
        try {
            jobs = planProductGenerationJobs(configNodes, nodesRef.current, connectionsRef.current, nanoid());
        } catch (error) {
            message.error(error instanceof Error ? error.message : "无法确定批量结果位置");
            return;
        }
        batchGenerationRunning.current = true;
        beginBatchCanvasSave(projectId);
        const imageNodes = jobs.filter(job => job.mode === "image");
        const boundedNodes = jobs.filter(job => job.mode !== "image");
        message.info(`已加入 ${jobs.length} 个生成任务，共 ${productGenerationImageCount(jobs, effectiveConfig.canvasImageCount || effectiveConfig.count)} 张图片；生图任务立即并行执行，视频、音频和文本最多同时执行 3 个`);
        let failed = 0;
        const runOne = async (job: ProductGenerationJob) => {
            const node = nodesRef.current.find((item) => item.id === job.source.id);
            if (!node) return;
            try {
                await handleGenerateNode(node.id, job.mode, job.prompt, job.placement);
            } catch {
                failed++;
            }
        };
        const runImages = settleActivityGroup(imageNodes.map(runOne));
        let cursor = 0;
        const worker = async () => {
            while (cursor < boundedNodes.length) await runOne(boundedNodes[cursor++]);
        };
        try {
            // 生图不再经过数量 worker；其余模式继续保留原有 3 路限制。
            await settleActivityGroup([
                runImages,
                settleActivityGroup(Array.from({ length: Math.min(3, boundedNodes.length) }, worker)),
            ]);
            if (failed) message.warning(`${failed} 个任务提交失败，其余任务已继续执行`);
        } finally {
            const needsSave = finishBatchCanvasSave(projectId);
            if (needsSave !== null) {
                let saveOutcome: "saved" | "not-saved" | "failed" = needsSave ? "failed" : "not-saved";
                try {
                    if (needsSave) {
                        // 最终快照保存期间继续保持批量门控；force 只放行这一笔
                        // 收尾保存，避免 React 订阅在其前后插入普通整画布写入。
                        await saveCanvas(projectId, { force: true });
                        saveOutcome = "saved";
                    }
                } catch (error) {
                    message.error(error instanceof Error ? `批量任务已结束，但最终画布保存未确认：${error.message}` : "批量任务已结束，但最终画布保存未确认。请检查保存状态后重试。");
                } finally {
                    completeBatchCanvasSave(projectId, saveOutcome);
                }
            }
            batchGenerationRunning.current = false;
        }
    }, [handleGenerateNode, message, nodesRef, connectionsRef, effectiveConfig.canvasImageCount, effectiveConfig.count, projectId, saveCanvas]);

    const completeAndGenerateRunning = useRef(false);
    const completeAndGenerateAll = useCallback(async () => {
        if (completeAndGenerateRunning.current) return;
        completeAndGenerateRunning.current = true;
        beginBatchCanvasSave(projectId);
        try {
            // Completion updates nodesRef/connectionsRef synchronously, so
            // generation includes the new cards without waiting on a render.
            addGenerationConfigsForPromptNodes();
            await generateAllConfigNodes();
        } catch {
            message.error("批量生成未完成，请检查生成任务的错误信息后重试");
        } finally {
            const needsSave = finishBatchCanvasSave(projectId);
            if (needsSave !== null) {
                let saveOutcome: "saved" | "not-saved" | "failed" = needsSave ? "failed" : "not-saved";
                try {
                    if (needsSave) {
                        await saveCanvas(projectId, { force: true });
                        saveOutcome = "saved";
                    }
                } catch (error) {
                    message.error(error instanceof Error ? `批量任务已结束，但最终画布保存未确认：${error.message}` : "批量任务已结束，但最终画布保存未确认。请检查保存状态后重试。");
                } finally {
                    completeBatchCanvasSave(projectId, saveOutcome);
                }
            }
            completeAndGenerateRunning.current = false;
        }
    }, [addGenerationConfigsForPromptNodes, generateAllConfigNodes, message, projectId, saveCanvas]);

    return { addGenerationConfigsForPromptNodes, generateAllConfigNodes, completeAndGenerateAll };
}
