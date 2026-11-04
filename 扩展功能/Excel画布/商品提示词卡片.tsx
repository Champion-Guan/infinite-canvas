import { useEffect, useRef, useState } from "react";
import { Languages, RotateCcw } from "lucide-react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { useExcelProductId } from "./Excel画布上下文";
import { ProductOptionSelect } from "./产品选项下拉";
import { productVariants, variantLabel } from "./产品变体规则";
import { isPromptReady, promptDocument, promptPair, type BilingualPrompt, type ProductPromptMetadata } from "./商品提示词规则";

export function ProductPromptContent({ ctx }: { ctx: CanvasNodeContext }) {
    const productId = useExcelProductId(), doc = promptDocument(ctx.node);
    const [selection, setSelection] = useState(""), [translating, setTranslating] = useState(false);
    const latest = useRef(ctx); latest.current = ctx;
    const controller = useRef<AbortController | null>(null);
    const variantIds = Object.keys(doc?.variants || {});
    const variantId = variantIds.includes(selection) ? selection : variantIds[0];
    const pair = doc && promptPair(doc, variantId);
    const chinese = pair?.chinese, translationError = pair?.translationError, translatedChinese = pair?.translatedChinese;
    useEffect(() => {
        if (!chinese?.trim() || chinese === translatedChinese || translationError) return;
        const job = new AbortController(); controller.current = job;
        setTranslating(true);
        const timer = setTimeout(async () => {
            try {
                const { translateProductPrompt } = await import("./商品策划请求");
                job.signal.throwIfAborted();
                await translateProductPrompt(latest.current, productId, variantId, job.signal);
            } catch (error) {
                if (job.signal.aborted) return;
                const current = latest.current, document = promptDocument(current.getNode(current.node.id));
                const value = document && promptPair(document, variantId);
                if (document && value?.chinese === chinese) current.updateMetadata({ productImagePrompt: variantId
                    ? { ...document, variants: { ...document.variants, [variantId]: { ...value, translationError: error instanceof Error ? error.message : "翻译失败，请重试。" } } }
                    : { ...document, prompt: { ...value, translationError: error instanceof Error ? error.message : "翻译失败，请重试。" } } } as ProductPromptMetadata);
            } finally { if (controller.current === job) { controller.current = null; setTranslating(false); } }
        }, 650);
        return () => { clearTimeout(timer); job.abort(); if (controller.current === job) { controller.current = null; setTranslating(false); } };
    }, [ctx.node.id, productId, variantId, chinese, translatedChinese, translationError]);
    if (!doc || !pair) return <div className="p-3 text-xs">提示词数据不完整</div>;
    const updatePair = (patch: Partial<BilingualPrompt>) => {
        controller.current?.abort();
        const current = latest.current, document = promptDocument(current.getNode(current.node.id));
        if (!document) return;
        const value = { ...promptPair(document, variantId)!, ...patch };
        current.updateMetadata({ productImagePrompt: variantId
            ? { ...document, variants: { ...document.variants, [variantId]: value } }
            : { ...document, prompt: value } } as ProductPromptMetadata);
    };
    const parameter = ctx.getNode(doc.parameterId);
    const variants = productVariants(parameter?.metadata);
    const retired = (ctx.node.metadata as ProductPromptMetadata)?.productPromptRetired;
    const style = { borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text };
    const fieldClass = "w-full resize-y rounded-md border bg-transparent p-2 text-xs leading-5 outline-none focus:ring-2 focus:ring-stone-400/50";
    return <div data-canvas-no-zoom className="flex h-full min-h-0 flex-col p-3 text-xs" style={{ color: ctx.theme.node.text }}
        onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-semibold">{doc.name}</span>
            <span className="shrink-0 text-[10px] opacity-60">{doc.delivery.width} x {doc.delivery.height} · {doc.delivery.format.toUpperCase()}</span>
        </div>
        {retired ? <p className="mb-2 text-[11px] text-amber-700 dark:text-amber-300">旧方案已保留，批量生成使用新方案。</p> : null}
        {variantIds.length ? <div className="mb-2">
            <ProductOptionSelect label="提示词变体" value={variantId || ""} options={variantIds.map(id => ({
                value: id, label: variants.find(variant => variant.id === id) ? variantLabel(variants.find(variant => variant.id === id)!) : id,
            }))} onChange={setSelection} borderColor={style.borderColor} textColor={style.color} />
        </div> : null}
        <div className="thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <label className="block"><span className="mb-1 block font-medium">中文提示词</span>
                <textarea aria-label="中文提示词" rows={7} className={fieldClass} style={style} value={pair.chinese}
                    onChange={event => updatePair({ chinese: event.target.value, translationError: undefined })} />
            </label>
            <div className="flex items-center gap-1 text-[10px]" role="status">
                <Languages aria-hidden className="size-3.5" />
                {translationError ? <span role="alert" className="text-red-600 dark:text-red-400">{translationError}</span>
                    : translating ? "正在同步英文…" : isPromptReady(pair) ? "英文已同步" : "等待同步英文"}
                {translationError ? <button type="button" title="重试翻译" aria-label="重试翻译" onClick={() => updatePair({ translationError: undefined })}
                    className="ml-auto rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"><RotateCcw className="size-3.5" /></button> : null}
            </div>
            <label className="block"><span className="mb-1 block font-medium">英文生图提示词</span>
                <textarea aria-label="英文生图提示词" lang="en" rows={7} className={fieldClass} style={style} value={pair.english}
                    onChange={event => updatePair({ english: event.target.value, translatedChinese: pair.chinese, translationError: undefined })} />
            </label>
            <dl className="space-y-2 text-[11px] leading-5">
                {([["买家问题", doc.buyerQuestion], ["商品事实与参考图", doc.evidence], ["画面与摄影", doc.composition],
                    ["禁止改动与生成错误", doc.constraints], ["文案与排版", doc.copyLayout], ["人工检查", doc.checks]] as const)
                    .map(([label, text]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap opacity-70">{text}</dd></div>)}
            </dl>
        </div>
    </div>;
}
