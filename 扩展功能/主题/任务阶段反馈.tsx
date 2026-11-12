import { LoaderCircle } from "lucide-react";

export type TextTaskPhase = "preparing" | "checking" | "saving-task" | "requesting" | "streaming" | "saving-result" | "validating" | "repairing" | "applying" | "ready" | "needs-input" | "stopped";
export type TextTaskKind = "planning" | "optimization";

export function textTaskPhaseLabel(phase: TextTaskPhase, kind: TextTaskKind) {
    const action = kind === "planning" ? "策划" : "优化";
    return {
        preparing: kind === "planning" ? "正在核对商品资料与读取参考图…" : "正在核对原文与优化要求…",
        checking: `正在核对上次${action}任务…`,
        "saving-task": `正在保存${action}任务…`,
        requesting: `正在等待模型${action}结果…`,
        streaming: `正在生成${action}内容…`,
        "saving-result": `已收到${action}结果，正在保存…`,
        validating: `正在检查${action}结果…`,
        repairing: "正在修正已返回方案的格式与变量关联…",
        applying: "正在保存原卡片…",
        ready: kind === "planning" ? "提示词已更新并保存" : "优化结果已保存，等待应用",
        "needs-input": "策划已保存，请补齐待确认资料。",
        stopped: "已停止本次等待；已提交任务的结果将按原任务恢复。",
    }[phase];
}

export function TextTaskStatus({ phase, kind, compact = false }: { phase: TextTaskPhase; kind: TextTaskKind; compact?: boolean }) {
    const working = phase !== "ready" && phase !== "stopped" && phase !== "needs-input";
    return <div role="status" aria-live="polite" aria-atomic="true" data-text-task-phase={phase}
        className={`flex min-h-6 min-w-0 items-start gap-2 ${compact ? "max-w-52 text-left text-[10px]" : "mb-3 text-sm"} leading-6 opacity-75`}>
        {working ? <LoaderCircle aria-hidden className="mt-1 size-4 shrink-0 animate-spin motion-reduce:animate-none" /> : null}
        <span className="min-w-0 break-words">{textTaskPhaseLabel(phase, kind)}</span>
    </div>;
}
