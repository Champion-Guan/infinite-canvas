import { useEffect, useRef, useState } from "react";
import { Languages, RotateCcw } from "lucide-react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { useExcelProductId } from "./Excel画布上下文";
import { translateProductPrompt } from "./商品策划请求";
import { productImageTextLanguage } from "./商品图片语言";
import type { ProductVariantMetadata } from "./产品变体规则";
import { productPromptProblems } from "./商品提示词状态";
import { BilingualPromptField, useBilingualPromptSync } from "../提示词/双语联动文本框";
import { isPromptReady, productPromptTranslationError, promptDocument, promptPair, type BilingualPrompt, type ProductPromptMetadata } from "./商品提示词规则";

export function ProductPromptContent({ ctx }: { ctx: CanvasNodeContext }) {
    const productId = useExcelProductId(), doc = promptDocument(ctx.node);
    const [translating, setTranslating] = useState(false);
    const latest = useRef(ctx); latest.current = ctx;
    const controller = useRef<AbortController | null>(null);
    const variantId = doc?.variantId;
    const pair = doc && promptPair(doc, variantId);
    const chinese = pair?.chinese, translationError = pair?.translationError, translatedChinese = pair?.translatedChinese;
    const bilingual = useBilingualPromptSync({ chinese: pair?.chinese || "", english: pair?.english || "",
        alignment: pair?.alignment, ready: isPromptReady(pair) });
    useEffect(() => {
        if (!chinese?.trim() || chinese === translatedChinese || translationError) return;
        const job = new AbortController(); controller.current = job;
        setTranslating(true);
        const timer = setTimeout(async () => {
            try {
                job.signal.throwIfAborted();
                await translateProductPrompt(latest.current, productId, variantId, job.signal);
            } catch (error) {
                if (job.signal.aborted) return;
                const current = latest.current, document = promptDocument(current.getNode(current.node.id));
                const value = document && promptPair(document, variantId);
                if (document && value?.chinese === chinese) {
                    const translationError = productPromptTranslationError(error);
                    current.updateMetadata({ productImagePrompt: variantId
                        ? { ...document, variants: { ...document.variants, [variantId]: { ...value, translationError } } }
                        : { ...document, prompt: { ...value, translationError } } } as ProductPromptMetadata);
                }
            } finally { if (controller.current === job) { controller.current = null; setTranslating(false); } }
        }, 650);
        return () => { clearTimeout(timer); job.abort(); if (controller.current === job) { controller.current = null; setTranslating(false); } };
    }, [ctx.node.id, productId, variantId, chinese, translatedChinese, translationError]);
    if (!doc || !pair) return <div className="p-3 text-xs">提示词数据不完整</div>;
    const updatePair = (patch: Partial<BilingualPrompt>) => {
        controller.current?.abort();
        const current = latest.current, document = promptDocument(current.getNode(current.node.id));
        if (!document) return;
        const value = { ...promptPair(document, variantId)!, ...patch, alignment: undefined };
        current.updateMetadata({ productImagePrompt: variantId
            ? { ...document, variants: { ...document.variants, [variantId]: value } }
            : { ...document, prompt: value } } as ProductPromptMetadata);
    };
    const parameter = ctx.getNode(doc.parameterId);
    const problems = productPromptProblems(ctx.node, parameter);
    const language = productImageTextLanguage((parameter?.metadata as ProductVariantMetadata | undefined)?.productLanguage);
    const failure = translationError ? productPromptTranslationError(translationError) : "";
    const style = { borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text };
    const fieldClass = "w-full min-w-0 max-w-full resize-y rounded-md border bg-transparent p-2 text-xs leading-5 outline-none focus:ring-2 focus:ring-stone-400/50";
    return <div data-canvas-no-zoom className="flex h-full w-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden p-3 text-xs" style={{ color: ctx.theme.node.text }}
        onMouseDown={event => { if ((event.target as HTMLElement).closest("input, textarea, button, select, [contenteditable=true]")) event.stopPropagation(); }}
        onPointerDown={event => { if ((event.target as HTMLElement).closest("input, textarea, button, select, [contenteditable=true]")) event.stopPropagation(); }}
        onWheel={event => event.stopPropagation()}>
        <div className={`mb-2 min-w-0 shrink-0 cursor-grab items-center gap-2 active:cursor-grabbing ${problems.length ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" : "flex justify-between"}`}>
            <span aria-hidden={ctx.isSelected || undefined} title={doc.planName || doc.name}
                className={`min-w-0 truncate font-semibold ${ctx.isSelected ? "invisible" : ""}`}>{ctx.node.title}</span>
            {problems.length ? <p role="alert" title={problems.join("\n")} style={{ margin: 0 }} className="justify-self-center whitespace-nowrap font-semibold text-red-600 dark:text-red-400">提示词已失效</p> : null}
            <span className="shrink-0 justify-self-end whitespace-nowrap text-[10px] opacity-60">{doc.delivery.width} x {doc.delivery.height} · {doc.delivery.format.toUpperCase()}</span>
        </div>
        <div className="guan-scroll-region thin-scrollbar min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto pr-1 [overflow-wrap:anywhere]">
            <label className="block min-w-0"><span className="mb-1 block font-medium">中文提示词</span>
                <BilingualPromptField link={bilingual} language="chinese" aria-label="中文提示词" rows={7} className={"guan-scroll-field " + (fieldClass || "")} style={style} value={pair.chinese}
                    onChange={event => updatePair({ chinese: event.target.value, translationError: undefined })} />
            </label>
            <div className="flex h-6 min-w-0 items-center gap-1 text-[10px]" role="status">
                <Languages aria-hidden className="size-3.5 shrink-0" />
                <span role={failure ? "alert" : undefined} title={failure || undefined}
                    className={`min-w-0 flex-1 truncate ${failure ? "text-red-600 dark:text-red-400" : ""}`}>
                    {failure || (translating ? "正在同步英文…" : isPromptReady(pair) ? "英文已同步" : "等待同步英文")}
                </span>
                {translationError ? <button type="button" title="重试翻译" aria-label="重试翻译" onClick={() => updatePair({ translationError: undefined })}
                    className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10"><RotateCcw className="size-3.5" /></button> : null}
                <span className="shrink-0 opacity-60">图片文字：{language}</span>
            </div>
            <label className="block min-w-0"><span className="mb-1 block font-medium">英文生图提示词</span>
                <BilingualPromptField link={bilingual} language="english" aria-label="英文生图提示词" rows={7} className={"guan-scroll-field " + (fieldClass || "")} style={style} value={pair.english}
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
