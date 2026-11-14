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
import { inheritedProductPlanningPatch } from "./商品策划副本规则";
import { retryPlanningSave, useAutomaticPlanningSave } from "./策划自动保存";
import { StatusDetails } from "../主题/状态详情";
import type { ProductPlanningTask } from "./商品策划任务状态";

export function ProductPlanningButton({ ctx, productId }: { ctx: CanvasNodeContext; productId: string }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [phase, setPhase] = useState<TextTaskPhase | null>(null);
    const streamingText = useProductPlanningText(ctx.node);
    const inherited = inheritedProductPlanningPatch(ctx.node, productId);
    const recovery = inherited ? undefined : productPlanningRecovery(ctx.node);
    const task = (ctx.node.metadata as { productPlanningTask?: ProductPlanningTask })?.productPlanningTask;
    const visibleError = error || (!inherited && task?.status === "error" ? "上次策划未完成，原任务记录已保留。请按下方入口继续。" : "");
    const actionLabel = recovery?.kind === "save" ? "重试保存" : recovery?.label || (!inherited && (ctx.node.metadata as PlanningRecoveryMetadata)?.productPlanningResolution ? "重新策划" : "AI写提示词");
    const controller = useRef<AbortController | null>(null);
    const runningAction = useRef<typeof recovery>(undefined);
    useEffect(() => {
        const parameter = ctx.getNode(ctx.node.id);
        if (!parameter) return;
        const patch = inheritedProductPlanningPatch(parameter, productId);
        if (patch) { ctx.updateMetadata(patch); return; }
        const ops = mergeLegacyProductPrompts(parameter, ctx.getNodes(), ctx.getConnections());
        if (ops.length) ctx.applyOps(ops);
        const titles = compactProductPromptTitles(parameter, ctx.getNodes());
        if (titles.length) ctx.applyOps(titles);
    }, [ctx, productId]);
    useEffect(() => () => { controller.current?.abort(); controller.current = null; }, [ctx.node.id, productId]);
    const start = async (automatic = false): Promise<boolean> => {
        if (controller.current) return true;
        if (automatic && (inheritedProductPlanningPatch(ctx.getNode(ctx.node.id) || ctx.node, productId)
            || productPlanningRecovery(ctx.getNode(ctx.node.id))?.kind !== "save")) return false;
        const job = new AbortController();
        runningAction.current = recovery;
        controller.current = job; setBusy(true); setError(""); setPhase("preparing");
        try {
            const { planProductImages } = await import("./商品策划请求");
            job.signal.throwIfAborted();
            await planProductImages(ctx, productId, job.signal, value => { if (controller.current === job && !job.signal.aborted) setPhase(value); },
                { recoverOnly: recovery?.kind === "save" || recovery?.kind === "query", repairOnly: recovery?.kind === "repair" });
            return false;
        } catch (error) {
            if (controller.current === job && !job.signal.aborted) {
                setError(productPlanningRecoveryError(error, productPlanningRecovery(ctx.getNode(ctx.node.id))?.kind));
                setPhase(null);
            }
            return automatic && !job.signal.aborted && retryPlanningSave(error);
        } finally {
            if (controller.current === job) { controller.current = null; setBusy(false); }
        }
    };
    useAutomaticPlanningSave({
        identity: recovery?.kind === "save" ? `${productId}:${ctx.node.id}:${recovery.taskId}` : "",
        busy, start: () => start(true),
    });
    return <div className="min-w-0 shrink-0 text-right">
        <AppleActionButton onClick={busy ? () => { controller.current?.abort(); controller.current = null; setBusy(false); setPhase("stopped"); } : () => void start()}
            aria-label={busy ? runningAction.current ? "停止等待" : "取消策划" : actionLabel}
            className="inline-flex items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[11px] font-medium transition-colors">
            {busy ? <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : recovery ? <RotateCcw aria-hidden className="size-3.5" /> : <Sparkles aria-hidden className="size-3.5" />}
            {busy ? runningAction.current?.kind === "save" ? "自动保存中" : runningAction.current?.kind === "query" ? "查询原任务中" : "策划中" : actionLabel}{busy ? <X aria-hidden className="size-3" /> : null}
        </AppleActionButton>
        {phase ? <TextTaskStatus phase={phase === "requesting" && streamingText ? "streaming" : phase} kind="planning" compact /> : null}
        {!busy && (visibleError || recovery) ? <div className="mt-1 flex justify-end">
            <StatusDetails label={visibleError ? recovery?.kind === "save" ? "保存待确认" : recovery ? "策划失败" : "待重新策划" : "任务详情"} failed={Boolean(visibleError)}>
                {visibleError ? <p>{visibleError}</p> : null}
                {recovery ? <p className="text-muted-foreground">{recovery.hint}</p> : null}
                <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-current/20 px-2.5 py-1.5"
                    onClick={() => void start()}><RotateCcw aria-hidden className="size-3.5" />{actionLabel}</button>
            </StatusDetails>
            {visibleError ? <span role="status" className="sr-only">策划未完成，请查看任务详情。</span> : null}
        </div> : null}
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
            {plan.pendingFacts.length || plan.confirmations?.length ? <div><dt className="font-medium text-amber-700 dark:text-amber-300">待确认</dt>
                <dd>{ctx && productId ? <ProductConfirmationList ctx={ctx} productId={productId} />
                    : <span className="whitespace-pre-wrap">{plan.pendingFacts.join("\n")}</span>}</dd></div> : null}
            {([
                ["目标买家", plan.overview.buyers], ["核心卖点", plan.overview.sellingPoints],
                ["购买顾虑", plan.overview.concerns], ["视觉风格", plan.style],
                ["一致性约束", plan.overview.consistency], ["顺序与分工", plan.overview.sequence],
            ] as const).map(([label, text]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap opacity-75"><ImageReferenceText text={text} images={references} /></dd></div>)}
            {plan.assumptions.length ? <div><dt className="font-medium">本次制作假设</dt><dd><ImageReferenceText text={plan.assumptions.join("\n")} images={references} /></dd></div> : null}
            {plan.preserved ? <div>已保留 {plan.preserved} 张手工修改的旧方案，批量生成使用新方案。</div> : null}
        </dl>
    </details>;
}
