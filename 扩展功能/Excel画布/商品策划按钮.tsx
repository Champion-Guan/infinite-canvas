import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { ProductPromptMetadata } from "./商品提示词规则";
import { compactProductPromptTitles, expandLegacyProductPrompts } from "./商品提示词画布";
import { AppleActionButton } from "../主题/苹果交互按钮";
import { TextTaskStatus, type TextTaskPhase } from "../主题/任务阶段反馈";

export function ProductPlanningButton({ ctx, productId }: { ctx: CanvasNodeContext; productId: string }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [phase, setPhase] = useState<TextTaskPhase | null>(null);
    const controller = useRef<AbortController | null>(null);
    useEffect(() => {
        const parameter = ctx.getNode(ctx.node.id);
        if (!parameter) return;
        const ops = expandLegacyProductPrompts(parameter, ctx.getNodes(), ctx.getConnections());
        if (ops.length) ctx.applyOps(ops);
        const titles = compactProductPromptTitles(parameter, ctx.getNodes());
        if (titles.length) ctx.applyOps(titles);
    }, [ctx]);
    useEffect(() => () => { controller.current?.abort(); controller.current = null; }, [ctx.node.id, productId]);
    const start = async () => {
        if (controller.current) return;
        const job = new AbortController();
        controller.current = job; setBusy(true); setError(""); setPhase("preparing");
        try {
            const { planProductImages } = await import("./商品策划请求");
            job.signal.throwIfAborted();
            await planProductImages(ctx, productId, job.signal, value => { if (controller.current === job && !job.signal.aborted) setPhase(value); });
        } catch (error) {
            if (controller.current === job && !job.signal.aborted) { setError(error instanceof Error ? error.message : "策划失败，请重试。"); setPhase(null); }
        } finally {
            if (controller.current === job) { controller.current = null; setBusy(false); }
        }
    };
    return <div className="min-w-0 shrink-0 text-right">
        <AppleActionButton onClick={busy ? () => { controller.current?.abort(); controller.current = null; setBusy(false); setPhase("stopped"); } : start}
            aria-label={busy ? "取消策划" : "AI写提示词"}
            className="inline-flex items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[11px] font-medium transition-colors">
            {busy ? <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Sparkles aria-hidden className="size-3.5" />}
            {busy ? "策划中" : "AI写提示词"}{busy ? <X aria-hidden className="size-3" /> : null}
        </AppleActionButton>
        {phase ? <TextTaskStatus phase={phase} kind="planning" compact /> : null}
        {error ? <p role="alert" className="mt-1 max-w-44 whitespace-normal text-left text-[10px] text-red-600 dark:text-red-400">{error}</p> : null}
    </div>;
}

export function ProductPlanOverview({ metadata }: { metadata: ProductPromptMetadata }) {
    const plan = metadata.productImagePlan;
    if (!plan) return null;
    return <details className="border-t border-current/15 pt-2 text-[11px]" open={plan.pendingFacts.length > 0}>
        <summary className="cursor-pointer font-medium">整套策划 · {plan.imageCount} 张{plan.pendingFacts.length ? ` · ${plan.pendingFacts.length} 项待确认` : ""}</summary>
        <dl className="mt-2 space-y-2 leading-5">
            {([
                ["目标买家", plan.overview.buyers], ["核心卖点", plan.overview.sellingPoints],
                ["购买顾虑", plan.overview.concerns], ["视觉风格", plan.style],
                ["一致性约束", plan.overview.consistency], ["顺序与分工", plan.overview.sequence],
            ] as const).map(([label, text]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap opacity-75">{text}</dd></div>)}
            {plan.assumptions.length ? <div><dt className="font-medium">本次制作假设</dt><dd>{plan.assumptions.join("\n")}</dd></div> : null}
            {plan.pendingFacts.length ? <div><dt className="font-medium text-amber-700 dark:text-amber-300">待确认</dt><dd className="whitespace-pre-wrap">{plan.pendingFacts.join("\n")}</dd></div> : null}
            {plan.preserved ? <div>已保留 {plan.preserved} 张手工修改的旧方案，批量生成使用新方案。</div> : null}
        </dl>
    </details>;
}
