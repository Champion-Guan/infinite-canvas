import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { ProductPromptMetadata } from "./商品提示词规则";

export function ProductPlanningButton({ ctx, productId }: { ctx: CanvasNodeContext; productId: string }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), [ctx.node.id, productId]);
    const start = async () => {
        if (controller.current) return;
        const job = new AbortController();
        controller.current = job; setBusy(true); setError("");
        try {
            const { planProductImages } = await import("./商品策划请求");
            job.signal.throwIfAborted();
            await planProductImages(ctx, productId, job.signal);
        } catch (error) {
            if (!job.signal.aborted) setError(error instanceof Error ? error.message : "策划失败，请重试。");
        } finally {
            if (controller.current === job) { controller.current = null; setBusy(false); }
        }
    };
    return <div className="min-w-0 shrink-0 text-right">
        <button type="button" onClick={busy ? () => controller.current?.abort() : start}
            aria-label={busy ? "取消策划" : "AI写提示词"}
            className="inline-flex items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[11px] font-medium transition active:scale-[.97] motion-reduce:transform-none motion-reduce:transition-none">
            {busy ? <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Sparkles aria-hidden className="size-3.5" />}
            {busy ? "策划中" : "AI写提示词"}{busy ? <X aria-hidden className="size-3" /> : null}
        </button>
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
