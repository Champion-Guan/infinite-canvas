import { useState } from "react";
import { Button, Checkbox, Tooltip } from "antd";
import { AppleModal as Modal } from "../主题/苹果弹窗";
import { Check, ChevronDown, Copy, Images, Plus, Trash2, X } from "lucide-react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { MediaThumbnail } from "../媒体交付/媒体缩略图";
import { ParameterImageThumbnail } from "./参数图片预览";
import { productMainImages } from "./产品主图规则";
import { PRODUCT_BRIEF_FIELDS, variableLabel } from "./旧版参数规则";
import { DEFAULT_VARIANT_ATTRIBUTES, groupVariantImagesByFilename, newProductVariant, productVariants, variantLabel, type ProductVariant, type ProductVariantMetadata } from "./产品变体规则";
import { generationProductParameters, generationPromptVariantId } from "../画布生成/产品变体生成";
import type { ProductPromptMetadata } from "./商品提示词规则";
import { getGenerationCount } from "@/lib/canvas/canvas-generation-helpers";
import { ImageUploadNumber } from "../媒体交付/图片上传编号";

export function ProductVariantEditor({ ctx, onChange, tokens }: {
    ctx: CanvasNodeContext; onChange: (patch: CanvasNodeMetadata) => void; tokens: string[];
}) {
    const metadata = ctx.node.metadata as ProductVariantMetadata || {};
    const variants = productVariants(metadata);
    const images = productMainImages(metadata);
    const attributes = metadata.productVariantAttributes || DEFAULT_VARIANT_ATTRIBUTES;
    const [expanded, setExpanded] = useState<string | null>(null);
    const [picking, setPicking] = useState<string | null>(null);
    const [newAttribute, setNewAttribute] = useState("");
    const [notice, setNotice] = useState("");
    const [removing, setRemoving] = useState<string | null>(null);
    const current = () => ctx.getNode(ctx.node.id)?.metadata as ProductVariantMetadata | undefined;
    const change = (update: (items: ProductVariant[]) => ProductVariant[]) => onChange({ productVariants: update(productVariants(current())) } as ProductVariantMetadata);
    const edit = (id: string, update: (variant: ProductVariant) => ProductVariant) => change(items => items.map(item => item.id === id ? update(item) : item));
    const style = { borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text };
    const inputClass = "h-8 w-full min-w-0 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40";
    const iconClass = "grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-black/[.06] focus-visible:outline-2 motion-reduce:transition-none dark:hover:bg-white/[.08]";
    const assigned = new Set([...variants.flatMap(variant => variant.imageIds), ...metadata.productSharedImageIds || []]);
    const selected = variants.filter(variant => variant.enabled).length;
    const target = variants.find(variant => variant.id === picking);
    const selectedIds = picking === "shared" ? metadata.productSharedImageIds || [] : target?.imageIds || [];
    const nodes = ctx.getNodes(), connections = ctx.getConnections();
    const linkedConfigs = variants.length ? nodes.filter(node => node.type === "config" && (node.metadata?.generationMode || "image") === "image"
        && !(node.metadata as ProductPromptMetadata)?.productPromptRetired
        && generationProductParameters(node.id, nodes, connections).some(parameter => parameter.id === ctx.node.id)) : [];
    const imageCount = linkedConfigs.reduce((count, node) => {
        try {
            const variantId = generationPromptVariantId(node.id, nodes, connections);
            const copies = variantId ? Number(variants.some(variant => variant.id === variantId && variant.enabled)) : selected;
            return count + copies * getGenerationCount(String(node.metadata?.count || 1));
        } catch {
            // 连线尚在编辑时不让预估使画布崩溃；执行入口会说明具体的变体冲突。
            return count;
        }
    }, 0);
    const choose = (id: string, checked: boolean) => {
        const update = (ids: string[]) => checked ? [...new Set([...ids, id])] : ids.filter(item => item !== id);
        if (picking === "shared") onChange({ productSharedImageIds: update(current()?.productSharedImageIds || []) } as ProductVariantMetadata);
        else if (picking) edit(picking, item => {
            const imageIds = update(item.imageIds);
            return { ...item, imageIds, primaryImageId: imageIds.includes(item.primaryImageId || "") ? item.primaryImageId : imageIds[0] };
        });
    };
    return (
        <section className="space-y-2 border-t pt-3" style={style} aria-label="产品变体" data-product-variants
            onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-xs font-semibold">产品变体 <span className="font-normal opacity-55">{variants.length ? `已选 ${selected}/${variants.length}` : ""}</span></div>
                <Tooltip title="添加变体"><button type="button" aria-label="添加变体" className={iconClass} onClick={() => {
                    const variant = newProductVariant();
                    change(items => [...items, variant]); setExpanded(variant.id);
                }}><Plus className="size-4" /></button></Tooltip>
            </div>
            {variants.length ? (
                <>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                        <Checkbox checked={selected === variants.length} indeterminate={selected > 0 && selected < variants.length}
                            onChange={event => change(items => items.map(item => ({ ...item, enabled: event.target.checked })))}>全选</Checkbox>
                        <button type="button" className="underline-offset-2 hover:underline" onClick={() => setPicking("shared")}>共用图片 {metadata.productSharedImageIds?.length || 0}</button>
                        <span className="opacity-55">未分配 {images.filter(image => !assigned.has(image.id)).length} 张</span>
                    </div>
                    {linkedConfigs.length ? <p className="text-[10px] opacity-55">关联 {linkedConfigs.length} 个生图配置 · 预计 {imageCount} 张</p> : null}
                    <div className="flex flex-wrap items-center gap-1">
                        {attributes.map(attribute => (
                            <span key={attribute} className="flex items-center gap-1 rounded bg-black/[.04] py-1 pl-2 pr-1 text-[10px] dark:bg-white/[.06]">
                                {attribute}<button type="button" className="grid size-4 place-items-center" aria-label={`移除变体属性 ${attribute}`} onClick={() => {
                                    onChange({ productVariantAttributes: attributes.filter(item => item !== attribute),
                                        productVariants: productVariants(current()).map(item => ({ ...item, attributes: Object.fromEntries(Object.entries(item.attributes).filter(([key]) => key !== attribute)) })) } as ProductVariantMetadata);
                                }}><X className="size-3" /></button>
                            </span>
                        ))}
                        <form className="flex min-w-0 items-center gap-1" onSubmit={event => {
                            event.preventDefault(); const value = newAttribute.trim();
                            if (value && !attributes.includes(value)) onChange({ productVariantAttributes: [...attributes, value] } as ProductVariantMetadata);
                            setNewAttribute("");
                        }}>
                            <input aria-label="新变体属性" placeholder="添加属性" className="h-6 w-20 min-w-0 rounded border bg-transparent px-1.5 text-[10px]" style={style} value={newAttribute} onChange={event => setNewAttribute(event.target.value)} />
                            <button type="submit" className={iconClass} aria-label="添加变体属性"><Plus className="size-3" /></button>
                        </form>
                    </div>
                    <div className="divide-y rounded-lg border" style={style}>
                        {variants.map(variant => {
                            const open = expanded === variant.id;
                            const primary = images.find(image => image.id === (variant.primaryImageId || variant.imageIds[0]));
                            return <div key={variant.id} className="min-w-0 p-2" data-variant-id={variant.id}>
                                <div className="flex min-w-0 items-center gap-2">
                                    <Checkbox aria-label={`生成 ${variantLabel(variant)}`} checked={variant.enabled} onChange={event => edit(variant.id, item => ({ ...item, enabled: event.target.checked }))} />
                                    {primary ? <ParameterImageThumbnail image={primary} name={`变体 ${variantLabel(variant)} · ${primary.name}`}
                                        className="grid size-8 shrink-0 place-items-center overflow-hidden rounded border" style={style} /> : null}
                                    <button type="button" aria-label={`编辑变体 ${variantLabel(variant)}`} aria-expanded={open} onClick={() => setExpanded(open ? null : variant.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                                        {!primary ? <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded border" style={style}><Images className="size-4 opacity-40" /></div> : null}
                                        <span className="min-w-0 flex-1 truncate text-xs">{variantLabel(variant)}<span className="ml-1 text-[10px] opacity-50">{variant.imageIds.length} 张</span></span>
                                        <ChevronDown className={`size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
                                    </button>
                                    <Tooltip title="复制变体"><button type="button" aria-label={`复制变体 ${variantLabel(variant)}`} className={iconClass} onClick={() => {
                                        const copy = { ...variant, id: crypto.randomUUID(), name: `${variantLabel(variant)} 副本`, attributes: { ...variant.attributes }, imageIds: [...variant.imageIds] };
                                        change(items => [...items, copy]); setExpanded(copy.id);
                                    }}><Copy className="size-3.5" /></button></Tooltip>
                                    <Tooltip title="删除变体"><button type="button" aria-label={`删除变体 ${variantLabel(variant)}`} className={iconClass} onClick={() => setRemoving(variant.id)}><Trash2 className="size-3.5" /></button></Tooltip>
                                </div>
                                <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} inert={!open}>
                                    <div className="min-h-0 overflow-hidden">
                                        <div className="space-y-2 pt-3">
                                            <label className="block text-[11px]">变体名称<input aria-label="变体名称" className={`${inputClass} mt-1`} style={style} value={variant.name} placeholder="例如：红色 / M / 2件装" onChange={event => edit(variant.id, item => ({ ...item, name: event.target.value }))} /></label>
                                            <div className="grid grid-cols-2 gap-2">{attributes.map(attribute => <label key={attribute} className="block min-w-0 text-[11px]">{attribute}<Tooltip title={`填写本变体的${attribute}。共用提示词可使用 [${attribute}]，生成时按变体替换；空白项沿用共用资料。`} trigger={["hover", "focus"]}><input aria-label={`变体${attribute}`} className={`${inputClass} mt-1`} style={style} value={variant.attributes[attribute] || ""} onChange={event => edit(variant.id, item => ({ ...item, attributes: { ...item.attributes, [attribute]: event.target.value } }))} /></Tooltip></label>)}</div>
                                            <button type="button" onClick={() => setPicking(variant.id)} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border text-xs hover:bg-black/[.04] dark:hover:bg-white/[.06]" style={style}><Images className="size-3.5" />分配图片 {variant.imageIds.length} 张</button>
                                            <details className="text-[11px]">
                                                <summary className="cursor-pointer py-1">差异资料与 Excel 变量</summary>
                                                <div className="space-y-2 pt-2">
                                                    {PRODUCT_BRIEF_FIELDS.filter(field => !["colorModel", "carouselCount", "richContent"].includes(field.key)).map(field => <label key={field.key} className="block">
                                                        <span className="mb-1 block">{field.label}</span><Tooltip title={field.help} trigger={["hover", "focus"]}>
                                                            <textarea aria-label={`变体${field.label}`} rows={2} className={"guan-scroll-field " + (`${inputClass} h-auto resize-y py-1.5` || "")} style={style}
                                                                placeholder={metadata.productBrief?.[field.key] || "继承共用资料"} value={variant.brief?.[field.key] || ""}
                                                                onChange={event => edit(variant.id, item => ({ ...item, brief: { ...item.brief, [field.key]: event.target.value } }))} />
                                                        </Tooltip>
                                                    </label>)}
                                                    {tokens.map(token => <label key={token} className="block">{variableLabel(token)}<input aria-label={`变体变量 ${token}`} className={`${inputClass} mt-1`} style={style} placeholder={metadata.promptVariableValues?.[token] || "继承共用变量"}
                                                        value={variant.variableValues?.[token] || ""} onChange={event => edit(variant.id, item => ({ ...item, variableValues: { ...item.variableValues, [token]: event.target.value } }))} /></label>)}
                                                </div>
                                            </details>
                                        </div>
                                    </div>
                                </div>
                            </div>;
                        })}
                    </div>
                </>
            ) : null}
            {images.length ? <button type="button" className="text-[11px] underline-offset-2 hover:underline" onClick={() => {
                const before = productVariants(current());
                const latest = current();
                const next = groupVariantImagesByFilename(productMainImages(latest).filter(image => !latest?.productSharedImageIds?.includes(image.id)), before);
                onChange({ productVariants: next } as ProductVariantMetadata);
                setNotice(next.length === before.length && next.every((item, index) => item.imageIds.length === before[index].imageIds.length)
                    ? "未找到新的分组。文件名可使用“红色__正面.png”“红色__背面.png”。" : "已按文件名分组，请核对变体名称和图片。");
            }}>按文件名分组</button> : null}
            {notice ? <p role="status" className="text-[10px] leading-4 opacity-60">{notice}</p> : null}
            <Modal title={picking === "shared" ? "共用图片" : `${target ? variantLabel(target) : ""} · 分配图片`} open={Boolean(picking)} onCancel={() => setPicking(null)}
                footer={null} destroyOnHidden width={640}>
                <div className="guan-scroll-region max-h-[60vh] space-y-3 overflow-y-auto">
                    {!images.length ? <p>请先上传产品主图。</p> : <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">{images.map((image, index) => {
                        const checked = selectedIds.includes(image.id);
                        return <div key={image.id} className="min-w-0 space-y-1">
                            <button type="button" aria-label={`选择图片 ${image.name}`} aria-pressed={checked} onClick={() => choose(image.id, !checked)} className={`relative grid aspect-square w-full overflow-hidden rounded-lg border-2 transition-colors motion-reduce:transition-none ${checked ? "border-blue-500 bg-blue-500/10" : "border-transparent bg-black/[.04]"}`}>
                                <MediaThumbnail storageKey={image.storageKey} fallback={image.url} alt={image.name} className="h-full min-h-0 w-full object-contain" />
                                <ImageUploadNumber number={index + 1} />
                                <span aria-hidden="true" className={`pointer-events-none absolute right-1 top-1 grid size-5 place-items-center rounded border ${checked ? "border-blue-500 bg-blue-500 text-white" : "border-black/20 bg-white"}`}>{checked ? <Check className="size-3.5" /> : null}</span>
                            </button>
                            <p className="truncate text-xs" title={image.name}>{image.name}</p>
                            {picking !== "shared" && checked ? <button type="button" className="text-xs" onClick={() => { if (picking) edit(picking, item => ({ ...item, primaryImageId: image.id })); }}>{target?.primaryImageId === image.id ? "主参考图" : "设为主参考图"}</button> : null}
                        </div>;
                    })}</div>}
                    <div className="flex items-center justify-between gap-3 border-t pt-3 text-sm"><span>已选 {selectedIds.length} 张</span><Button type="primary" onClick={() => setPicking(null)}>完成</Button></div>
                </div>
            </Modal>
            <Modal title="删除这个变体？" open={Boolean(removing)} onCancel={() => setRemoving(null)} okText="删除变体" cancelText="取消" okButtonProps={{ danger: true }}
                onOk={() => { change(items => items.filter(item => item.id !== removing)); setRemoving(null); }}>
                <p>产品主图与已经生成的结果会保留。</p>
            </Modal>
        </section>
    );
}
