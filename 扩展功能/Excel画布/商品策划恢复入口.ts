import type { CanvasNodeData } from "@/types/canvas";
import type { ProductPromptMetadata } from "./商品提示词规则";
import { productPlanningCommit } from "./商品策划协议恢复";

export type PlanningResolution = { taskId: string; status: "succeeded" | "failed" };
export type PlanningRecoveryMetadata = ProductPromptMetadata & { productPlanningResolution?: PlanningResolution };
export function productPlanningRecovery(node?: CanvasNodeData | null) {
    const metadata = node?.metadata as PlanningRecoveryMetadata | undefined;
    const commit = productPlanningCommit(node);
    const task = metadata?.gatewayGenerationTasks?.filter(task =>
        task.slotId === "product-image-plan" || task.slotId === "product-image-plan-repair").at(-1);
    if (commit) return { kind: "save" as const, ...commit, label: "继续保存",
        hint: "提示词卡片已生成，保存确认尚未完成；继续保存会沿用原任务。" };
    if (!task || metadata?.productPlanningResolution?.taskId === task.taskId) return undefined;
    const candidate = (metadata as PlanningRecoveryMetadata & { productPlanningCandidate?: { taskId: string } })?.productPlanningCandidate;
    if (candidate) return { kind: "repair" as const, ...task, label: "继续修正", hint: "已保留模型返回的方案，继续只修正该方案。" };
    const receipt = metadata?.gatewayGenerationReceipts?.find(item => item.taskId === task.taskId);
    if (receipt && Number.isSafeInteger(metadata?.productImagePlan?.imageCount)) return { kind: "save" as const, ...task, label: "继续保存",
        hint: "已有策划结果，仅需核对并确认保存，不会重新策划。" };
    return { kind: "query" as const, ...task, label: "查询原任务", hint: "原任务记录已保留，查询不会新建或重复提交策划。" };
}
export const productPlanningResolutionPatch = (resolution: PlanningResolution): PlanningRecoveryMetadata =>
    ({ productPlanningResolution: resolution });
export function productPlanningRecoveryError(error: unknown, kind?: "save" | "query" | "repair") {
    const code = (error as { code?: string } | null)?.code;
    const temporary = ["request_timeout", "generation_connection_unknown", "generation_canvas_unsaved",
        "generation_canvas_unconfirmed", "generation_http_busy", "generation_unavailable", "generation_ack_invalid"].includes(code || "");
    if (temporary && kind === "save") return "提示词卡片已生成，保存确认尚未完成。请点“继续保存”，不会重新策划。";
    if (temporary && kind === "query") return "原任务状态暂未确认。请点“查询原任务”继续，不会重复提交策划。";
    if (kind === "repair" && ["invalid_product_plan_keys", "invalid_confirmation_protocol", "product_plan_repair_incomplete"].includes(code || ""))
        return "图片编号或待确认条件尚需修正，返回方案和原卡片均已保留。请点“继续修正”，不会重做整套策划。";
    return error instanceof Error ? error.message : "策划未完成，请查询原任务后继续。";
}
