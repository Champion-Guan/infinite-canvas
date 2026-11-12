import { useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { LoaderCircle } from "lucide-react";
import type { CanvasNodeData } from "@/types/canvas";
import { textPreviewSnapshot, subscribeTextPreview } from "../画布生成/文本临时显示.mjs";
import { productPlanningPreviewText, readProductPlanningPreview } from "./商品策划预览规则";
import type { ProductVariantMetadata } from "./产品变体规则";
import { imageReferenceCatalog, type ImageReferenceLabel } from "./图片引用标签规则";
import { ImageReferenceText } from "./图片引用标签";

const noPreview = () => "";
export function useProductPlanningText(node: CanvasNodeData) {
    const subscribe = useCallback((listener: () => void) => subscribeTextPreview(node.id, listener), [node.id]);
    const read = useCallback(() => productPlanningPreviewText(node, textPreviewSnapshot(node.id)), [node]);
    return useSyncExternalStore(subscribe, read, noPreview);
}

function PromptPreview({ chinese, english, images }: { chinese: string; english: string; images: ImageReferenceLabel[] }) {
    return <>
        {chinese ? <p className="whitespace-pre-wrap break-words leading-5"><ImageReferenceText text={chinese} images={images} /></p> : null}
        {english ? <details className="mt-1">
            <summary className="cursor-pointer opacity-65">英文提示词</summary>
            <p className="mt-1 whitespace-pre-wrap break-words leading-5" lang="en"><ImageReferenceText text={english} images={images} /></p>
        </details> : null}
    </>;
}

export function ProductPlanningStreamPreview({ node }: { node: CanvasNodeData }) {
    const raw = useProductPlanningText(node);
    const taskId = node.metadata?.gatewayGenerationTasks?.find(item => item.slotId === "product-image-plan")?.taskId;
    const snapshot = useMemo(() => ({ nodeId: node.id, taskId, raw }), [node.id, taskId, raw]);
    const deferred = useDeferredValue(snapshot);
    const plan = useMemo(() => readProductPlanningPreview(
        deferred.nodeId === node.id && deferred.taskId === taskId ? deferred.raw : "",
    ), [deferred, node.id, taskId]);
    const contentRef = useRef<HTMLDivElement>(null), followingRef = useRef(true);
    useLayoutEffect(() => {
        if (!raw) { followingRef.current = true; return; }
        const content = contentRef.current;
        if (followingRef.current && content) content.scrollTop = content.scrollHeight;
    }, [raw, deferred]);
    const variants = (node.metadata as ProductVariantMetadata | undefined)?.productVariants || [];
    const references = imageReferenceCatalog(node.metadata);
    if (!raw) return null;
    return <section aria-label="实时策划预览" aria-busy="true" className="min-w-0 border-y border-current/15 py-2 text-[11px]">
        <div className="mb-2 flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                <LoaderCircle aria-hidden className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
                策划预览
            </span>
            <span className="shrink-0 opacity-60">未保存</span>
        </div>
        <div ref={contentRef} data-canvas-no-zoom tabIndex={0} aria-label="策划预览内容"
            onScroll={event => {
                const content = event.currentTarget;
                followingRef.current = content.scrollHeight - content.scrollTop - content.clientHeight < 24;
            }}
            className="guan-scroll-region thin-scrollbar max-h-80 min-h-20 overflow-y-auto overscroll-contain pr-1 [overflow-wrap:anywhere]">
            {plan.overview.length ? <div>
                <h4 className="mb-1 font-semibold">整体方案</h4>
                <dl className="space-y-1.5 leading-5">{plan.overview.map(field => <div key={field.label}>
                    <dt className="font-medium">{field.label}</dt>
                    <dd className="whitespace-pre-wrap opacity-75"><ImageReferenceText text={field.text} images={references} /></dd>
                </div>)}</dl>
            </div> : null}
            {plan.images.map((image, index) => <section key={index} className="mt-3 border-t border-current/10 pt-2">
                <h4 className="mb-1 font-semibold">{index + 1}. {image.kind}{image.kind && image.name ? " · " : ""}{image.name}</h4>
                <dl className="mb-2 space-y-1 leading-5">{image.fields.map(field => <div key={field.label}>
                    <dt className="font-medium">{field.label}</dt>
                    <dd className="whitespace-pre-wrap opacity-75"><ImageReferenceText text={field.text} images={references} /></dd>
                </div>)}</dl>
                <PromptPreview {...image.prompt} images={references} />
                {image.variants.map(variant => <div key={variant.id} className="mt-2">
                    <h5 className="mb-1 font-medium">{variants.find(item => item.id === variant.id)?.name || "变体"}</h5>
                    <PromptPreview {...variant.prompt} images={references} />
                </div>)}
            </section>)}
            {!plan.overview.length && !plan.images.length ? <p className="opacity-60">正在接收策划内容…</p> : null}
        </div>
    </section>;
}
