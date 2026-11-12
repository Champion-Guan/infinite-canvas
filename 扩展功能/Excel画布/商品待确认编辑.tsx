import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input, Segmented } from "antd";
import { FileText, ImagePlus, RefreshCw, X } from "lucide-react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { AppleModal } from "../主题/苹果弹窗";
import { ParameterImageThumbnail } from "./参数图片预览";
import { uploadConfirmationFiles } from "./商品待确认上传";
import { ProductOptionSelect } from "./产品选项下拉";
import { confirmationAnswer, confirmationAnswered, confirmationAnswerPatch, confirmationEvidence, confirmationFields, factTokens,
    type Confirmation, type ConfirmationAnswer, type ConfirmationMetadata } from "./商品待确认规则";
import { promptDocument, type ProductPromptMetadata } from "./商品提示词规则";
import { imageReferenceCatalog } from "./图片引用标签规则";

function ConfirmationImages({ ctx, productId, field, variantId }: {
    ctx: CanvasNodeContext; productId: string; field: Confirmation; variantId?: string;
}) {
    const input = useRef<HTMLInputElement>(null), latest = useRef(ctx); latest.current = ctx;
    const alive = useRef<AbortController | null>(null), running = useRef(false);
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const answer = confirmationAnswer(ctx.node.metadata as ConfirmationMetadata, field, variantId);
    const references = imageReferenceCatalog(ctx.node.metadata);
    useEffect(() => {
        const controller = new AbortController(); alive.current = controller;
        return () => { controller.abort(); };
    }, [ctx.node.id, field.id, variantId, productId]);
    const change = (operation: (images: ConfirmationAnswer["images"]) => ConfirmationAnswer["images"]) => {
        const current = latest.current.getNode(ctx.node.id);
        if (!current) throw Error("原产品参数卡已移除，未写入其他画布。");
        const metadata = current.metadata as ConfirmationMetadata;
        latest.current.updateMetadata(confirmationAnswerPatch(metadata, field, variantId,
            { images: operation(confirmationAnswer(metadata, field, variantId)?.images || []) }));
    };
    const upload = async (files: File[]) => {
        const signal = alive.current?.signal;
        if (running.current || !files.length || !signal || signal.aborted) return;
        running.current = true; setBusy(true); setError("");
        try {
            const { uploadImage } = await import("@/services/image-storage");
            await uploadConfirmationFiles({ ctx: latest.current, productId, field, variantId, files, signal, upload: uploadImage });
        } catch (failure) {
            if (!signal.aborted) setError(failure instanceof Error ? failure.message : "上传未完成，请重试。");
        } finally { running.current = false; if (!signal.aborted) setBusy(false); }
    };
    return <div className="space-y-2">
        <input ref={input} type="file" multiple accept="image/*,.heic,.heif" className="hidden" aria-label={`上传${field.label}参考图`}
            onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void upload(files); }} />
        <Button size="small" icon={<ImagePlus size={14} />} loading={busy} onClick={() => input.current?.click()}>上传对应参考图</Button>
        {answer?.images.length ? <div className="flex flex-wrap gap-2">{answer.images.map(image => <div key={image.id}
            className="relative size-16 overflow-hidden rounded-md border border-current/15">
            <ParameterImageThumbnail image={image} number={references.find(item => item.id === image.id)?.number} name={image.name} className="block size-full" />
            <button type="button" title="移除本项引用" aria-label={`移除本项参考图 ${image.name}`}
                className="absolute right-0 top-0 grid size-5 place-items-center rounded bg-white/90 text-black"
                onClick={() => change(images => images.filter(item => item.id !== image.id))}><X size={12} /></button>
        </div>)}</div> : null}
        {answer?.images.length ? <p role="status" className="opacity-60">已上传 {answer.images.length} 张，仅供本事项关联卡片核对，不加入全局参考图。</p> : null}
        {error ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : null}
    </div>;
}

function ConfirmationRow({ ctx, productId, field, initialVariant }: {
    ctx: CanvasNodeContext; productId: string; field: Confirmation; initialVariant?: string;
}) {
    const metadata = ctx.node.metadata as ConfirmationMetadata;
    const variants = metadata.productVariants || [];
    const [selectedVariant, setSelectedVariant] = useState(initialVariant || variants[0]?.id || "");
    const variantId = field.scope === "variant" ? selectedVariant : undefined;
    const answer = confirmationAnswer(metadata, field, variantId);
    const filled = confirmationAnswered(field, answer);
    const evidence = answer?.evidence ?? confirmationEvidence(metadata.promptVariableSupplement, field);
    const supplied = Boolean(answer?.images.length || evidence.trim());
    const [evidenceOpen, setEvidenceOpen] = useState(false);
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const latest = useRef(ctx); latest.current = ctx;
    const flight = useRef<AbortController | null>(null);
    useEffect(() => () => { flight.current?.abort(); }, [ctx.node.id, field.id, productId]);
    const candidates = ctx.getNodes().flatMap(node => {
        const doc = promptDocument(node);
        return doc?.parameterId === ctx.node.id
            && !(node.metadata as ProductPromptMetadata).productPromptRetired ? [{ node, doc }] : [];
    });
    const docs = candidates.filter(({ doc }) => field.imageKeys.includes(doc.key));
    const bound = docs.some(({ doc }) => [doc.prompt, ...Object.values(doc.variants)].some(pair => factTokens(pair.chinese).includes(field.id)));
    const update = (patch: Partial<Pick<ConfirmationAnswer, "value" | "scope" | "unit" | "evidence">>) => {
        const current = latest.current.getNode(ctx.node.id);
        try {
            if (current) latest.current.updateMetadata(confirmationAnswerPatch(current.metadata as ConfirmationMetadata, field, variantId, patch));
        } catch (failure) { setError(failure instanceof Error ? failure.message : "资料未保存，请重试。"); }
    };
    const setTargets = (key: string, enabled: boolean) => {
        const current = latest.current.getNode(ctx.node.id);
        if (!current) return;
        const plan = (current.metadata as ProductPromptMetadata).productImagePlan;
        if (!plan) return;
        const items = confirmationFields(current.metadata as ConfirmationMetadata).map(item => item.id === field.id
            ? { ...item, imageKeys: enabled ? [...new Set([...item.imageKeys, key])] : item.imageKeys.filter(value => value !== key) } : item);
        latest.current.updateMetadata({ productImagePlan: { ...plan, confirmations: items } } as ProductPromptMetadata);
    };
    const closeEvidence = () => {
        setEvidenceOpen(false);
        void import("../产品/产品操作").then(({ saveProductCanvas }) => saveProductCanvas(productId))
            .then(result => { if (!result.persisted) setError("补充依据保留在当前画布，保存尚未确认，请重试保存后再刷新。"); })
            .catch(() => setError("补充依据保留在当前画布，保存未完成，请重试保存后再刷新。"));
    };
    const refresh = async () => {
        if (flight.current) return;
        const controller = new AbortController(); flight.current = controller; setBusy(true); setError("");
        try {
            const { updateProductConfirmationImages } = await import("./商品策划请求");
            await updateProductConfirmationImages(latest.current, productId, field.id, controller.signal);
        } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "提示词更新未完成。"); }
        finally { if (flight.current === controller) { flight.current = null; setBusy(false); } }
    };
    return <section data-confirmation-field={field.id} data-card-panel-anchor
        onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
        className="space-y-2 border-b border-current/10 py-3 last:border-0">
        <div className="flex items-start justify-between gap-2">
            <h4 className="min-w-0 font-medium">{field.label}</h4>
            <span className={`shrink-0 text-[10px] ${filled ? "text-green-700 dark:text-green-400" : "opacity-55"}`}>
                {filled ? bound ? "已同步变量" : "已填写，待更新" : supplied ? "已补充，待核对" : field.kind === "choice" ? "未知" : "待补充"}
            </span>
        </div>
        <p className="whitespace-pre-wrap leading-5 opacity-70">{field.question}</p>
        {field.scope === "variant" ? <ProductOptionSelect label={`${field.label}适用变体`} value={selectedVariant}
            options={variants.map(item => ({ value: item.id, label: item.name || item.id }))}
            onChange={setSelectedVariant} borderColor={ctx.theme.node.stroke} textColor={ctx.theme.node.text} /> : <p className="text-[10px] opacity-55">适用范围：共用商品资料</p>}
        {field.kind === "number" ? <div className="flex flex-wrap items-center gap-2">
            <Input size="small" inputMode="decimal" aria-label={field.label} placeholder="待填写" value={answer?.value || ""}
                className="min-w-24 flex-1" onChange={event => update({ value: event.target.value })} />
            {field.unit ? <span>{field.unit}</span> : <Input size="small" className="!w-20" aria-label={`${field.label}单位`}
                placeholder="单位" value={answer?.unit || ""} onChange={event => update({ unit: event.target.value })} />}
            {field.scopes.length ? <div className="min-w-32 flex-1"><ProductOptionSelect label={`${field.label}测量范围`}
                value={answer?.scope || ""} options={field.scopes.map(item => ({ value: item.value, label: item.chinese }))}
                onChange={value => update({ scope: value, value: "" })} borderColor={ctx.theme.node.stroke} textColor={ctx.theme.node.text} /></div> : null}
            {answer?.value && !filled ? <p className="w-full text-[10px] text-amber-700 dark:text-amber-400">请填写有效数值，并选择适用的测量范围。</p> : null}
        </div> : null}
        {field.kind === "choice" ? <Segmented size="small" aria-label={field.label} value={answer?.value || "unknown"}
            options={[{ value: "yes", label: "有" }, { value: "no", label: "无" }, { value: "unknown", label: "未知" }]}
            onChange={value => update({ value })} /> : null}
        {field.kind === "image" && (field.scope === "shared" || variantId) ? <ConfirmationImages key={variantId || "shared"}
            ctx={ctx} productId={productId} field={field} variantId={variantId} /> : null}
        <p role="status" className="text-[10px] leading-4 opacity-65">{!filled ? field.fallback : bound
            ? "已同步到关联提示词；已有图片保留，可按需重新生成。" : "当前方案未预留此变量，更新相关提示词后使用新资料。"}
        </p>
        <p title={docs.map(item => item.node.title || item.doc.name).join("、")} className="text-[10px] leading-4 opacity-55">影响：{!field.imageKeys.length
            ? "尚未选择卡片，不会应用到整套" : docs.slice(0, 3).map(item => item.node.title || item.doc.name).join("、")
                + (docs.length > 3 ? ` 等 ${docs.length} 张` : "") || "当前方案未使用此项"}</p>
        <details className="text-[10px]">
            <summary className="cursor-pointer opacity-70">选择关联提示词</summary>
            <div className="mt-2 grid max-h-36 gap-1 overflow-y-auto">{candidates.map(({ node, doc }) =>
                <Checkbox key={doc.key} aria-label={`${field.label}影响${node.title}`} checked={field.imageKeys.includes(doc.key)}
                    onChange={event => setTargets(doc.key, event.target.checked)}>{node.title || doc.name}</Checkbox>)}</div>
        </details>
        <div className="flex flex-wrap gap-2">
            <Button size="small" icon={<FileText size={13} />} onClick={() => setEvidenceOpen(true)}>{field.kind === "supplement" ? "补充依据" : "补充测试条件或依据"}</Button>
            {docs.length ? <Button size="small" icon={<RefreshCw size={13} />} loading={busy} onClick={() => void refresh()}>更新相关提示词</Button> : null}
            {busy ? <Button size="small" onClick={() => { flight.current?.abort(); flight.current = null; setBusy(false); }}>停止等待</Button> : null}
        </div>
        {evidence ? <p className="text-[10px] opacity-60">依据已填写；点击更新相关提示词后核对，不自动生图。</p> : null}
        {error ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : null}
        <AppleModal open={evidenceOpen} title={`补充依据 · ${field.label}`} footer={null} width={560} onCancel={closeEvidence}>
            <div className="space-y-3">
                <p className="text-xs opacity-60">影响：{docs.map(item => item.node.title || item.doc.name).join("、") || "尚未选择关联卡片"}
                    {variantId ? ` · ${variants.find(item => item.id === variantId)?.name || variantId}` : ""}</p>
                <Input.TextArea aria-label={`${field.label}的提示词补充`} value={evidence} rows={6}
                    placeholder="填写本事项的测试条件、来源或补充依据" onChange={event => update({ evidence: event.target.value })} />
                <p className="text-xs opacity-60">只用于本事项关联的提示词。已有图片保留，更新相关提示词后可按需重新生成。</p>
            </div>
        </AppleModal>
    </section>;
}

export function ProductConfirmationList({ ctx, productId, onlyField, variantId }: {
    ctx: CanvasNodeContext; productId: string; onlyField?: string; variantId?: string;
}) {
    const fields = confirmationFields(ctx.node.metadata as ConfirmationMetadata);
    return <div className="min-w-0 text-[11px]">{fields.filter(field => !onlyField || field.id === onlyField).map(field =>
        <ConfirmationRow key={field.id} ctx={ctx} productId={productId} field={field} initialVariant={variantId} />)}</div>;
}

export function ProductConfirmationDialog({ ctx, parameterId, productId, fieldId, variantId, onClose }: {
    ctx: CanvasNodeContext; parameterId: string; productId: string; fieldId: string | null; variantId?: string; onClose(): void;
}) {
    const parameter = ctx.getNode(parameterId);
    const parameterContext = parameter ? { ...ctx, node: parameter, updateMetadata: (patch: CanvasNodeContext["node"]["metadata"]) => {
        ctx.applyOps([{ type: "update_node", id: parameterId, metadata: patch }]);
    } } : undefined;
    return <AppleModal open={Boolean(fieldId && parameter)} title="待确认资料" footer={null} width={560}
        onCancel={onClose}>
        {fieldId && parameterContext ? <ProductConfirmationList ctx={parameterContext} productId={productId} onlyField={fieldId} variantId={variantId} /> : null}
    </AppleModal>;
}
