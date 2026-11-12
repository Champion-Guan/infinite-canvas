import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RotateCcw, Sparkles, X } from "lucide-react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { ProductPromptMetadata } from "./商品提示词规则";
import { compactProductPromptTitles, mergeLegacyProductPrompts } from "./商品提示词画布";
import { AppleActionButton } from "../主题/苹果交互按钮";
import { TextTaskStatus, type TextTaskPhase } from "../主题/任务阶段反馈";
import { ProductConfirmationList } from "./商品待确认编辑";
import { useProductPlanningText } from "./商品策划流式预览";
import { imageReferenceCatalog } from "./图片引用标签规则";
import { ImageReferenceText } from "./图片引用标签";
import { productPlanningRecovery, productPlanningRecoveryError, type PlanningRecoveryMetadata } from "./商品策划恢复入口";

export function ProductPlanningButton({ ctx, productId }: { ctx: CanvasNodeContext; productId: string }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [phase, setPhase] = useState<TextTaskPhase | null>(null);
    const streamingText = useProductPlanningText(ctx.node);
    const recovery = productPlanningRecovery(ctx.node);
    const actionLabel = recovery?.label || ((ctx.node.metadata as PlanningRecoveryMetadata)?.productPlanningResolution ? "重新策划" : "AI写提示词");
    const controller = useRef<AbortController | null>(null);
    const runningAction = useRef<typeof recovery>(undefined);
    useEffect(() => {
        const parameter = ctx.getNode(ctx.node.id);
        if (!parameter) return;
        const ops = mergeLegacyProductPrompts(parameter, ctx.getNodes(), ctx.getConnections());
        if (ops.length) ctx.applyOps(ops);
        const titles = compactProductPromptTitles(parameter, ctx.getNodes());
        if (titles.length) ctx.applyOps(titles);
    }, [ctx]);
    useEffect(() => () => { controller.current?.abort(); controller.current = null; }, [ctx.node.id, productId]);
    const start = async () => {
        if (controller.current) return;
        const job = new AbortController();
        runningAction.current = recovery;
        controller.current = job; setBusy(true); setError(""); setPhase("preparing");
        try {
            const { planProductImages } = await import("./商品策划请求");
            job.signal.throwIfAborted();
            await planProductImages(ctx, productId, job.signal, value => { if (controller.current === job && !job.signal.aborted) setPhase(value); },
                { recoverOnly: recovery?.kind === "save" || recovery?.kind === "query", repairOnly: recovery?.kind === "repair" });
        } catch (error) {
            if (controller.current === job && !job.signal.aborted) {
                setError(productPlanningRecoveryError(error, productPlanningRecovery(ctx.getNode(ctx.node.id))?.kind));
                setPhase(null);
            }
        } finally {
            if (controller.current === job) { controller.current = null; setBusy(false); }
        }
    };
    return <div className="min-w-0 shrink-0 text-right">
        <AppleActionButton onClick={busy ? () => { controller.current?.abort(); controller.current = null; setBusy(false); setPhase("stopped"); } : start}
            aria-label={busy ? runningAction.current ? "停止等待" : "取消策划" : actionLabel}
            className="inline-flex items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[11px] font-medium transition-colors">
            {busy ? <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : recovery ? <RotateCcw aria-hidden className="size-3.5" /> : <Sparkles aria-hidden className="size-3.5" />}
            {busy ? runningAction.current?.kind === "save" ? "确认保存中" : runningAction.current?.kind === "query" ? "查询原任务中" : "策划中" : actionLabel}{busy ? <X aria-hidden className="size-3" /> : null}
        </AppleActionButton>
        {phase ? <TextTaskStatus phase={phase === "requesting" && streamingText ? "streaming" : phase} kind="planning" compact /> : null}
        {error ? <p role="alert" className="mt-1 max-w-44 whitespace-normal text-left text-[10px] text-red-600 dark:text-red-400">{error}</p> : null}
        {!busy && recovery ? <p role="status" className="mt-1 max-w-52 text-left text-[10px] leading-5 opacity-65">{recovery.hint}</p> : null}
    </div>;
}

export function ProductPlanOverview({ metadata, ctx, productId }: { metadata: ProductPromptMetadata; ctx?: CanvasNodeContext; productId?: string }) {
    const plan = metadata.productImagePlan;
    const references = imageReferenceCatalog(metadata);
    if (!plan) return null;
    const count = plan.confirmations?.length ?? plan.pendingFacts.length;
    return <details className="border-t border-current/15 pt-2 text-[11px]" open={count > 0}>
        <summary className="cursor-pointer font-medium">整套策划 · {plan.imageCount} 张{count ? ` · ${count} 项待确认` : ""}</summary>
        <dl className="mt-2 space-y-2 leading-5">
            {([
                ["目标买家", plan.overview.buyers], ["核心卖点", plan.overview.sellingPoints],
                ["购买顾虑", plan.overview.concerns], ["视觉风格", plan.style],
                ["一致性约束", plan.overview.consistency], ["顺序与分工", plan.overview.sequence],
            ] as const).map(([label, text]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap opacity-75"><ImageReferenceText text={text} images={references} /></dd></div>)}
            {plan.assumptions.length ? <div><dt className="font-medium">本次制作假设</dt><dd><ImageReferenceText text={plan.assumptions.join("\n")} images={references} /></dd></div> : null}
            {plan.pendingFacts.length || plan.confirmations?.length ? <div><dt className="font-medium text-amber-700 dark:text-amber-300">待确认</dt>
                <dd>{ctx && productId ? <ProductConfirmationList ctx={ctx} productId={productId} />
                    : <span className="whitespace-pre-wrap">{plan.pendingFacts.join("\n")}</span>}</dd></div> : null}
            {plan.preserved ? <div>已保留 {plan.preserved} 张手工修改的旧方案，批量生成使用新方案。</div> : null}
        </dl>
    </details>;
}
