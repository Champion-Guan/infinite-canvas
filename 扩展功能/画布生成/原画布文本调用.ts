import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { AiTextMessage } from "@/services/api/image";
import { bindGenerationChannel, type CanvasImageTask, type CanvasImageReceipt } from "./原画布图片调用";
import { runCanvasImageTask } from "./图片任务衔接.mjs";
import { prepareTextRequest, parseTextResponse } from "./文本生成协议";
import { publishTextPreview, clearTextPreview } from "./文本临时显示.mjs";
import { requireModelConfigured } from "../产品配置/模型配置门禁";
import { recoverGenerationResponse } from "../生成任务/本机任务响应恢复.mjs";

export async function queryCanvasTextTask(scope: { productId: string; nodeId: string }, task: CanvasImageTask, signal: AbortSignal) {
    const host = (window as unknown as { __guanGenerationHost?: {
        get(id: string): Promise<{ id: string; productId: string; nodeId: string; state: string; applied: boolean }>;
    } }).__guanGenerationHost;
    if (!host?.get) throw Error("本机任务查询端口尚未接入，请重新打开工作台。");
    const result = await recoverGenerationResponse(() => host.get(task.taskId), { signal });
    if (result.id !== task.taskId || result.productId !== scope.productId || result.nodeId !== scope.nodeId)
        throw Error("原任务与当前产品或参数卡不匹配，未应用结果。");
    return result;
}

export async function confirmSavedCanvasText(scope: { productId: string; nodeId: string }, receipt: CanvasImageReceipt, signal: AbortSignal) {
    signal.throwIfAborted();
    const host = (window as unknown as { __guanGenerationHost?: {
        confirmSaved(task: { id: string; productId: string; nodeId: string }, options: { responseHash: string; signal: AbortSignal }): Promise<unknown>;
    } }).__guanGenerationHost;
    if (!host?.confirmSaved) throw Error("本机任务确认端口尚未接入，请重新打开工作台；不会重新生成。");
    await host.confirmSaved({ id: receipt.taskId, ...scope }, { responseHash: receipt.responseHash, signal });
    signal.throwIfAborted();
}

export async function retireMissingCanvasText(scope: { productId: string; nodeId: string }, task: CanvasImageTask, signal: AbortSignal) {
    signal.throwIfAborted();
    const host = (window as unknown as { __guanGenerationHost?: {
        get(id: string): Promise<unknown>;
        retirePreparedTask(value: { id: string; productId: string; nodeId: string; binding: string; requestHash: string }): Promise<{ state: string }>;
    } }).__guanGenerationHost;
    if (!host?.get || !host.retirePreparedTask) throw Error("旧任务收口端口尚未接入，未重新生成。");
    try { await host.get(task.taskId); }
    catch (error) {
        if ((error as { code?: string }).code !== "generation_not_found") throw error;
        signal.throwIfAborted();
        const retired = await host.retirePreparedTask({ id: task.taskId, ...scope, binding: task.binding, requestHash: task.requestHash });
        if (retired.state !== "cancelled") throw Error("上次任务状态已变化，请保留原任务等待结果。", { cause: error });
        return;
    }
    throw Error("旧任务仍存在，未按未提交任务收口。");
}

export async function requestCanvasText(options: {
    config: AiConfig; messages: AiTextMessage[];
    scope: { productId: string; nodeId: string; slotId: string };
    previous?: CanvasImageTask; signal?: AbortSignal; retry?: boolean; recoverOnly?: boolean;
    recordTask(task: CanvasImageTask): Promise<void>;
    applyAndSave(text: string, receipt: CanvasImageReceipt): Promise<unknown>;
    deferConfirm?: () => boolean;
}) {
    options.signal?.throwIfAborted();
    if (!options.previous) requireModelConfigured(options.config, "text", options.config.model || options.config.textModel);
    const host = (window as unknown as { __guanGenerationHost?: Parameters<typeof bindGenerationChannel>[0] }).__guanGenerationHost;
    if (!host) throw Error("本机生成端口尚未接入，请重新打开工作台；未改用浏览器直连。");
    const config = structuredClone(options.config);
    let result = "", observedTaskId = "";
    try { await runCanvasImageTask({
        host, scope: options.scope, previous: options.previous, signal: options.signal, retry: options.retry, recoverOnly: options.recoverOnly, deferConfirm: options.deferConfirm,
        prepare: async () => {
            requireModelConfigured(config, "text", config.model || config.textModel);
            const channel = resolveModelRequestConfig(config, config.model || config.textModel);
            return prepareTextRequest(channel, structuredClone(options.messages));
        },
        bind: () => bindGenerationChannel(host, config),
        recordTask: options.recordTask,
        onProgress: (text: string, taskId: string) => {
            if (options.signal?.aborted) return;
            observedTaskId = taskId;
            publishTextPreview({ nodeId: options.scope.nodeId, slotId: options.scope.slotId, taskId, text });
        },
        applyAndSave: async (job: { bytes: string }, receipt: CanvasImageReceipt) => {
            result = parseTextResponse(job.bytes);
            return await options.applyAndSave(result, receipt);
        },
    }); } finally { if (observedTaskId) clearTextPreview(options.scope.nodeId, observedTaskId); }
    return result;
}
