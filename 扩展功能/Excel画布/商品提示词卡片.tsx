import { useEffect, useMemo, useRef, useState } from "react";
import { Languages, Play, RotateCcw } from "lucide-react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { useExcelProductId } from "./Excel画布上下文";
import { translateProductPrompt } from "./商品策划请求";
import { productImageTextLanguage } from "./商品图片语言";
import type { ProductVariantMetadata } from "./产品变体规则";
import { productPromptProblems } from "./商品提示词状态";
import { productPromptEditingVariant, selectProductPromptVariant } from "./共用商品提示词";
import { TabContentTransition } from "../主题/页签内容过渡";
import { BilingualPromptField, useBilingualPromptSync } from "../提示词/双语联动文本框";
import { isPromptReady, productPromptTranslationError, promptDocument, promptPair, type BilingualPrompt, type ProductPromptMetadata } from "./商品提示词规则";
import { compileConfirmationPair, editConfirmationTemplate, type ConfirmationCompilation } from "./商品待确认提示词";
import { ProductConfirmationDialog } from "./商品待确认编辑";
import { confirmationFields, type ConfirmationMetadata } from "./商品待确认规则";
import { useGlobalPlatformRules } from "./平台规则订阅";
import { imageReferenceCatalog, projectImageReferences, restoreImageReferences } from "./图片引用标签规则";
import { ImageReferenceText, ImageReferenceToken } from "./图片引用标签";
import { ProductVariantGenerateButton } from "./商品变体生成按钮";
import { PromptVariantSelectAll, PromptVariantTabs } from "./提示词变体选择";
import { variantContentSnapshot } from "./变体正文快照";

export function ProductPromptContent({ ctx }: { ctx: CanvasNodeContext }) {
    useGlobalPlatformRules();
    const productId = useExcelProductId(), doc = promptDocument(ctx.node);
    const [translating, setTranslating] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(true);
    const latest = useRef(ctx); latest.current = ctx;
    const controller = useRef<AbortController | null>(null);
    const parameter = doc && ctx.getNode(doc.parameterId);
    const contentMetadata = useRef(parameter?.metadata);
    contentMetadata.current = variantContentSnapshot(contentMetadata.current, parameter?.metadata);
    const bodyMetadata = contentMetadata.current;
    const [selection, setSelection] = useState(() => productPromptEditingVariant(ctx.node));
    const variantId = doc?.variantId || (selection && doc?.variants[selection] ? selection : Object.keys(doc?.variants || {})[0]);
    const pair = doc && promptPair(doc, variantId);
    const [editingFact, setEditingFact] = useState<string | null>(null), [variableError, setVariableError] = useState("");
    const compilation = useMemo<ConfirmationCompilation | undefined>(() => {
        try { return doc && pair ? compileConfirmationPair(pair, bodyMetadata, doc.key, variantId, true) : undefined; }
        catch { return undefined; }
    }, [doc, pair, bodyMetadata, variantId]);
    const displayedPair = compilation?.pair || pair;
    const references = useMemo(() => imageReferenceCatalog(bodyMetadata), [bodyMetadata]);
    const views = useMemo(() => ({ chinese: projectImageReferences(displayedPair?.chinese || "", references),
        english: projectImageReferences(displayedPair?.english || "", references) }), [displayedPair?.chinese, displayedPair?.english, references]);
    const alignment = useMemo(() => displayedPair?.alignment?.map(([a, b, c, d]) => [views.chinese.position(a), views.chinese.position(b),
        views.english.position(c), views.english.position(d)] as [number, number, number, number]), [displayedPair?.alignment, views]);
    const chinese = pair?.chinese, translationError = pair?.translationError, translatedChinese = pair?.translatedChinese;
    const bilingual = useBilingualPromptSync({ chinese: views.chinese.text, english: views.english.text,
        alignment, ready: isPromptReady(pair) });
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
    const editField = (language: "chinese" | "english", value: string) => {
        try {
            const raw = restoreImageReferences(value, views[language], references);
            const text = compilation ? editConfirmationTemplate(displayedPair![language], raw, compilation.sections[language]) : raw;
            setVariableError("");
            updatePair(language === "chinese" ? { chinese: text, translationError: undefined }
                : { english: text, translatedChinese: pair.chinese, translationError: undefined });
        } catch (failure) { setVariableError(failure instanceof Error ? failure.message : "请在对应变量中填写资料。"); }
    };
    const problems = productPromptProblems(ctx.node, parameter, variantId);
    const language = productImageTextLanguage((parameter?.metadata as ProductVariantMetadata | undefined)?.productLanguage);
    const failure = translationError ? productPromptTranslationError(translationError) : "";
    const style = { borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text };
    const referenceProps = (language: "chinese" | "english") => ({
        value: views[language].text,
        variableRanges: compilation?.ranges[language].map(item => ({ ...item,
            start: views[language].position(item.start), end: views[language].position(item.end) })),
        inlineReferences: views[language].occurrences.map(item => ({ start: item.start, end: item.end,
            content: <ImageReferenceToken image={item.image} label={item.label} /> })),
    });
    const fieldClass = "w-full min-w-0 max-w-full resize-y rounded-md border bg-transparent p-2 text-xs leading-5 outline-none focus:ring-2 focus:ring-stone-400/50";
    const fields = confirmationFields(parameter?.metadata as ConfirmationMetadata);
    const related = fields.filter(field => field.imageKeys.includes(doc.key));
    const lastFactEdit = Math.max(0, ...((parameter?.metadata as ConfirmationMetadata | undefined)?.productConfirmations || [])
        .filter(answer => related.some(field => field.id === answer.factId) && (!answer.variantId || answer.variantId === variantId)).map(answer => answer.updatedAt));
    const configs = ctx.getConnections().filter(edge => edge.fromNodeId === ctx.node.id).map(edge => edge.toNodeId);
    const results = ctx.getConnections().filter(edge => configs.includes(edge.fromNodeId)).flatMap(edge => ctx.getNode(edge.toNodeId) || []);
    const staleResults = results.some(node => node.type === "image" && (node.metadata?.generationStartedAt || 0) < lastFactEdit);
    return <div data-canvas-no-zoom className="flex h-full w-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden p-3 text-xs" style={{ color: ctx.theme.node.text }}
        onMouseDown={event => { if ((event.target as HTMLElement).closest("input, textarea, button, select, [contenteditable=true]")) event.stopPropagation(); }}
        onPointerDown={event => { if ((event.target as HTMLElement).closest("input, textarea, button, select, [contenteditable=true]")) event.stopPropagation(); }}
        onWheel={event => event.stopPropagation()}>
        <div className={`mb-2 min-w-0 shrink-0 cursor-grab items-center gap-2 active:cursor-grabbing ${problems.length ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" : "flex justify-between"}`}>
            <span aria-hidden={ctx.isSelected || undefined} title={doc.planName || doc.name}
                className={`min-w-0 truncate font-semibold ${ctx.isSelected ? "invisible" : ""}`}>{ctx.node.title}</span>
            {problems.length ? <p role="alert" title={problems.join("\n")} style={{ margin: 0 }} className="justify-self-center whitespace-nowrap font-semibold text-red-600 dark:text-red-400">提示词已失效</p> : null}
            <div className="flex shrink-0 items-center justify-self-end gap-2">
                <span className="whitespace-nowrap text-[10px] opacity-60">{doc.delivery.width} x {doc.delivery.height} · {doc.delivery.format.toUpperCase()}</span>
                {Object.keys(doc.variants).length ? <PromptVariantSelectAll ctx={ctx} parameterId={doc.parameterId} ids={Object.keys(doc.variants)} /> : null}
            </div>
        </div>
        {Object.keys(doc.variants).length ? <PromptVariantTabs ctx={ctx} parameterId={doc.parameterId}
            ids={doc.variantId ? [doc.variantId] : Object.keys(doc.variants)} value={variantId}
            onChange={id => { selectProductPromptVariant(ctx.node.id, id); setSelection(id); }} /> : null}
        <TabContentTransition transitionKey={`${ctx.node.id}:${variantId || "base"}`} className="min-h-0 min-w-0 flex-1">
        <div className="guan-scroll-region thin-scrollbar min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto pr-1 [overflow-wrap:anywhere]">
            <label className="block min-w-0"><span className="mb-1 block font-medium">中文提示词</span>
                <BilingualPromptField link={bilingual} language="chinese" aria-label="中文提示词" rows={7} className={"guan-scroll-field " + (fieldClass || "")} style={style}
                    {...referenceProps("chinese")} onVariableClick={setEditingFact} onChange={event => editField("chinese", event.target.value)} />
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
                <BilingualPromptField link={bilingual} language="english" aria-label="英文生图提示词" rows={7} className={"guan-scroll-field " + (fieldClass || "")} style={style}
                    {...referenceProps("english")} onVariableClick={setEditingFact} onChange={event => editField("english", event.target.value)} />
            </label>
            {related.length ? <div className="space-y-1 border-t border-current/10 pt-2">
                {related.map(field => <div key={field.id} className="flex flex-wrap items-baseline gap-1 text-[10px]">
                    <button type="button" className="rounded bg-yellow-400/20 px-1 py-0.5 font-medium hover:bg-yellow-400/30"
                        onClick={() => setEditingFact(field.id)}>{field.label}</button>
                    <span role="status" className="opacity-60">{compilation?.states.find(state => state.field.id === field.id)?.filled
                        ? "已同步中英文" : field.fallback}</span>
                </div>)}
            </div> : null}
            {staleResults ? <p role="status" className="text-[10px] text-amber-700 dark:text-amber-400">参数已更新，可重新生成；已有图片保留。</p> : null}
            {variableError ? <p role="alert" className="text-[10px] text-red-600 dark:text-red-400">{variableError}</p> : null}
            <div className="border-t border-current/15 pt-2 text-[11px]">
                <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(open => !open)}
                    className="flex w-full cursor-pointer items-center gap-1 text-left font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                    <Play aria-hidden fill="currentColor" strokeWidth={0}
                        className={`size-2 shrink-0 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${detailsOpen ? "rotate-90" : ""}`} />
                    <span>策划详情</span>
                </button>
                <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${detailsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                    inert={!detailsOpen} aria-hidden={!detailsOpen}>
                    <div className="min-h-0 overflow-hidden">
                        <dl className="space-y-2 pt-2 leading-5">
                            {([["买家问题", doc.buyerQuestion], ["商品事实与参考图", doc.evidence], ["画面与摄影", doc.composition],
                                ["禁止改动与生成错误", doc.constraints], ["文案与排版", doc.copyLayout], ["人工检查", doc.checks]] as const)
                                .map(([label, text]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap opacity-70"><ImageReferenceText text={text} images={references} /></dd></div>)}
                        </dl>
                    </div>
                </div>
            </div>
        </div>
        </TabContentTransition>
        <ProductVariantGenerateButton ctx={ctx} productId={productId} variantId={variantId} />
        <ProductConfirmationDialog ctx={ctx} parameterId={doc.parameterId} productId={productId}
            fieldId={editingFact} variantId={variantId} onClose={() => setEditingFact(null)} />
    </div>;
}
