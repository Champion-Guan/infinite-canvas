import type { CanvasPluginHost } from "@/types/canvas-plugin";
import { useConfigStore } from "@/stores/use-config-store";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { requestCanvasText } from "../画布生成/原画布文本调用";
import { saveProductCanvas } from "../产品/产品操作";
import { PROMPT_OPTIMIZATION_SYSTEM, parseOptimizedPrompt, type OptimizationMetadata, type PromptOptimizationSource } from "./提示词优化规则";
import { normalizeOptimizationDirections, optimizationDirectionInstruction } from "./快捷优化方向";
import { requireModelConfigured } from "../产品配置/模型配置门禁";
import { productCanvasResidency } from "../产品/画布驻留保护";
import type { TextTaskPhase } from "../主题/任务阶段反馈";

export async function requestPromptOptimization({ host, productId, source, instruction, directions: selectedDirections = [], signal, assertActive, onPhase }: {
    host: CanvasPluginHost; productId: string; source: PromptOptimizationSource; instruction: string;
    directions?: string[]; signal: AbortSignal; assertActive(): void; onPhase?(phase: TextTaskPhase): void;
}) {
    const release = productCanvasResidency.acquire(productId);
    try {
    const phase = (value: TextTaskPhase) => { if (!signal.aborted) onPhase?.(value); };
    phase("preparing");
    const directions = normalizeOptimizationDirections(selectedDirections);
    const state = useConfigStore.getState(), config = {
        ...buildGenerationConfig(state.config, undefined, "text"), systemPrompt: "", textSystemPrompt: "",
    };
    requireModelConfigured(config, "text");
    const slotId = "prompt-optimization";
    const read = () => {
        signal.throwIfAborted(); assertActive();
        const node = host.getNode(source.id);
        if (!node) throw Error("原卡片已移除，优化已停止。");
        return node;
    };
    const save = async () => {
        const result = await saveProductCanvas(productId);
        if (!result.persisted) throw Error("画布保存尚未确认，请重试保存后继续。");
        return result;
    };
    const previous = read().metadata?.gatewayGenerationTasks?.find(task => task.slotId === slotId);
    const previousRequest = (read().metadata as OptimizationMetadata)?.promptOptimizationRequest;
    if (previous && (!previousRequest || previousRequest.taskId !== previous.taskId ||
        previousRequest.signature !== source.signature || previousRequest.instruction !== instruction || previousRequest.model !== config.model ||
        JSON.stringify(normalizeOptimizationDirections(previousRequest.directions)) !== JSON.stringify(directions))) {
        const service = (window as unknown as { __guanGenerationHost?: { get(id: string): Promise<{ state: string; applied?: boolean }> } }).__guanGenerationHost;
        phase("checking");
        const task = await service?.get(previous.taskId);
        signal.throwIfAborted(); assertActive();
        if (!task || !["failed", "cancelled"].includes(task.state) && !(task.state === "succeeded" && task.applied))
            throw Error("上一次优化任务尚未确认，不能用新的原文、要求或模型重复提交。请先恢复原条件完成该任务。");
    }
    phase("requesting");
    const raw = await requestCanvasText({ config, signal, retry: true, scope: { productId, nodeId: source.id, slotId },
        previous,
        messages: [{ role: "system", content: PROMPT_OPTIMIZATION_SYSTEM }, { role: "user", content: JSON.stringify({
            kind: source.kind, prompt: source.kind === "bilingual"
                ? { chinese: source.chinese, english: source.englishCurrent === false ? "" : source.english } : source.text,
            instruction, optimizationDirections: optimizationDirectionInstruction(directions), context: source.context, existingProblems: source.problems,
        }) }],
        recordTask: async task => {
            const node = read();
            phase("saving-task");
            host.updateMetadata(source.id, { gatewayGenerationTasks: [...(node.metadata?.gatewayGenerationTasks || [])
                .filter(item => item.slotId !== slotId), task],
                promptOptimizationRequest: { taskId: task.taskId, signature: source.signature, instruction, directions, model: config.model } } as OptimizationMetadata);
            await save();
            phase("requesting");
        },
        applyAndSave: async (raw, receipt) => {
            const node = read();
            if (node.metadata?.gatewayGenerationTasks?.find(task => task.slotId === slotId)?.taskId !== receipt.taskId)
                throw Error("已有更新的优化任务，旧结果未覆盖原卡片。");
            phase("saving-result");
            // 先持久保存完整响应与收据，再校验候选；模型格式错误也不会反复领取同一份响应。
            host.updateMetadata(source.id, { promptOptimizationDraft: { signature: source.signature, raw, instruction, directions, model: config.model },
                gatewayGenerationReceipts: [...(node.metadata?.gatewayGenerationReceipts || [])
                    .filter(item => item.taskId !== receipt.taskId), receipt] } as OptimizationMetadata);
            return save();
        },
    });
    signal.throwIfAborted();
    phase("validating");
    const result = parseOptimizedPrompt(raw, source);
    phase("ready");
    return result;
    } finally { release(); }
}
