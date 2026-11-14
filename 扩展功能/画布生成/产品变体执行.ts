import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { BatchResultPlacement } from "../画布布局/批量结果排布";
import { planProductGenerationJobs, productVariantExecutions, productGenerationImageCount, type ProductGenerationJob } from "./产品变体生成";
import { beginBatchCanvasSave, finishBatchCanvasSave, completeBatchCanvasSave } from "./批量保存协调";
import type { CanvasGenerationRequest } from "./并发生成状态";
import { validateProductPromptInputs } from "../Excel画布/商品提示词输入";
import { pulseProductPromptWarning } from "../Excel画布/商品提示词阻止反馈";
import { planSingleProductVariantJob, registerSingleVariantGeneration } from "./单变体生成";

type Port = {
    projectId: string;
    nodesRef: RefObject<CanvasNodeData[]>;
    connectionsRef: RefObject<CanvasConnection[]>;
    execute: (id: string, mode: CanvasNodeGenerationMode, prompt: string, placement?: BatchResultPlacement) => Promise<void>;
    saveCanvas: (id: string, options: { force: boolean }) => Promise<unknown>;
    message: { info: (value: string) => unknown; error: (value: string) => unknown };
    count?: string;
    generationRequestsRef: RefObject<ReadonlyMap<string, CanvasGenerationRequest>>;
};

export function useProductVariantGeneration({ projectId, nodesRef, connectionsRef, execute, saveCanvas, message, count, generationRequestsRef }: Port) {
    const running = useRef(new Set<string>());
    const isRunning = useCallback((id: string) => running.current.has(id) || [...generationRequestsRef.current.values()]
        .some(request => request.runningNodeId === id && !request.controller.signal.aborted), [generationRequestsRef]);
    const runJobs = useCallback(async (id: string, jobs: ProductGenerationJob[]) => {
        if (isRunning(id)) throw Error("该生图配置正在生成，请等待当前任务完成。");
        running.current.add(id);
        beginBatchCanvasSave(projectId);
        message.info(`开始生成 ${jobs.length} 个变体，共 ${productGenerationImageCount(jobs, count)} 张图片`);
        try {
            const outcomes = await Promise.allSettled(jobs.map(job => execute(id, job.mode, job.prompt, job.placement)));
            if (outcomes.some(item => item.status === "rejected")) message.error("部分变体提交失败，请查看对应结果卡片。");
        } finally {
            try {
                const needsSave = finishBatchCanvasSave(projectId);
                if (needsSave !== null) {
                    let outcome: "saved" | "failed" | "not-saved" = needsSave ? "failed" : "not-saved";
                    try { if (needsSave) { await saveCanvas(projectId, { force: true }); outcome = "saved"; } }
                    catch (error) { message.error(error instanceof Error ? error.message : "变体结果保存未确认，请重试保存。"); }
                    finally { completeBatchCanvasSave(projectId, outcome); }
                }
            } finally { running.current.delete(id); }
        }
    }, [projectId, execute, saveCanvas, message, count, isRunning]);
    useEffect(() => registerSingleVariantGeneration(projectId, async request => {
        const job = planSingleProductVariantJob(request, nodesRef.current, connectionsRef.current, crypto.randomUUID());
        let submitted = false;
        job.placement.onSubmitted = () => {
            if (submitted) return;
            submitted = true;
            request.onSubmitted?.();
        };
        await runJobs(job.source.id, [job]);
    }), [projectId, nodesRef, connectionsRef, runJobs]);
    return useCallback(async (id: string, mode: CanvasNodeGenerationMode, prompt: string, placement?: BatchResultPlacement) => {
        // 批量入口已经完成整批预检，不再次展开，避免变体平方倍提交。
        if (placement || mode !== "image") return execute(id, mode, prompt, placement);
        if (isRunning(id)) return;
        const node = nodesRef.current.find(item => item.id === id);
        if (!node) return;
        try {
            validateProductPromptInputs(id, nodesRef.current, connectionsRef.current);
            if (!productVariantExecutions(id, nodesRef.current, connectionsRef.current).length) return execute(id, mode, prompt);
            const jobs = planProductGenerationJobs([{ ...node, metadata: { ...node.metadata, prompt, composerContent: node.metadata?.composerContent ? prompt : undefined } }],
                nodesRef.current, connectionsRef.current, crypto.randomUUID());
            await runJobs(id, jobs);
        } catch (error) {
            if (!pulseProductPromptWarning(error)) message.error(error instanceof Error ? error.message : "变体生成检查未通过");
        }
    }, [nodesRef, connectionsRef, execute, message, isRunning, runJobs]);
}
