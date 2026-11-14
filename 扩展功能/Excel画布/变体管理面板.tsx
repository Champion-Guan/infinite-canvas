import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Popconfirm, Segmented, Tooltip } from "antd";
import { Check, Plus, Trash2, X } from "lucide-react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { AppleModal as Modal } from "../主题/苹果弹窗";
import { useProductActive } from "../产品/产品界面边界";
import { MediaThumbnail } from "../媒体交付/媒体缩略图";
import { ImageUploadNumber } from "../媒体交付/图片上传编号";
import { productMainImages } from "./产品主图规则";
import { DEFAULT_VARIANT_ATTRIBUTES, variantLabel, type ProductVariantMetadata } from "./产品变体规则";
import { addVariantGroup, createVariantManagerDraft, removeDraftVariant, toggleSingleVariantImage,
    variantImageOwner, variantManagerPatch, variantManagerRevision } from "./变体管理规则";
import styles from "./变体管理面板.module.css";

export function ProductVariantManager({ ctx, onChange, onClose }: {
    ctx: CanvasNodeContext; onChange(patch: CanvasNodeMetadata): void; onClose(): void;
}) {
    const active = useProductActive();
    useEffect(() => { if (!active) onClose(); }, [active, onClose]);
    const initial = useRef(ctx.getNode(ctx.node.id)?.metadata as ProductVariantMetadata || {});
    const revision = useRef(variantManagerRevision(initial.current));
    const [draft, setDraft] = useState(() => createVariantManagerDraft(initial.current,
        initial.current.productVariantAttributes || DEFAULT_VARIANT_ATTRIBUTES));
    const [mode, setMode] = useState<"single" | "group">("single");
    const [selection, setSelection] = useState<string[]>([]);
    const [attribute, setAttribute] = useState("");
    const [error, setError] = useState("");
    const latest = useRef(ctx); latest.current = ctx;
    const metadata = ctx.node.metadata as ProductVariantMetadata || {};
    const images = productMainImages(metadata);
    const style = { borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text };
    const inputClass = "h-8 w-full min-w-0 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40";
    const select = (id: string) => {
        setError("");
        if (mode === "single") setDraft(previous => toggleSingleVariantImage(previous, id, latest.current.getNode(ctx.node.id)?.metadata || {}));
        else setSelection(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
    };
    const edit = (id: string, key: "name" | "attribute" | "enabled" | "primary", value: string | boolean, field?: string) => {
        setError("");
        setDraft(previous => ({ ...previous, variants: previous.variants.map(variant => variant.id !== id ? variant
            : key === "attribute" ? { ...variant, attributes: { ...variant.attributes, [field!]: String(value) } }
            : key === "primary" ? { ...variant, primaryImageId: String(value) }
            : key === "enabled" ? { ...variant, enabled: Boolean(value) } : { ...variant, name: String(value) }) }));
    };
    const save = () => {
        try {
            if (mode === "group" && selection.length) throw Error("所选图片尚未添加为变体，请先点击“添加变体”，或取消选择。");
            const current = latest.current.getNode(ctx.node.id);
            if (!current) throw Error("原产品参数卡已移除，未写入其他卡片。");
            onChange(variantManagerPatch(draft, current.metadata || {}, revision.current));
            onClose();
        } catch (reason) { setError(reason instanceof Error ? reason.message : "变体保存未完成，请重试。"); }
    };
    return <Modal title="变体管理" open={active} onCancel={onClose} footer={null} width={1080} centered destroyOnHidden>
        <div data-canvas-no-zoom onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} style={{ color: ctx.theme.node.text }}>
            <div className={styles.layout}>
                <section aria-label="产品图片选择" className={styles.images}>
                    <Segmented block aria-label="变体创建方式" value={mode}
                        options={[{ label: "一图一个变体", value: "single" }, { label: "多图一个变体", value: "group" }]}
                        onChange={value => { setMode(value as typeof mode); setSelection([]); setError(""); }} />
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                        <span>产品主图 {images.length} 张</span>
                        <Checkbox checked={images.length > 0 && images.every(image => draft.sharedImageIds.includes(image.id) || variantImageOwner(draft, image.id) || selection.includes(image.id))}
                            onChange={event => {
                                const ids = images.filter(image => !draft.sharedImageIds.includes(image.id) && !variantImageOwner(draft, image.id)).map(image => image.id);
                                if (mode === "single") {
                                    if (event.target.checked) setDraft(previous => ids.reduce((next, id) => addVariantGroup(next, [id], metadata, true), previous));
                                    else setDraft(previous => Object.values(previous.addedByImage).reduce((next, id) => removeDraftVariant(next, id), previous));
                                } else setSelection(event.target.checked ? ids : []);
                            }}>选择未分配</Checkbox>
                    </div>
                    {!images.length ? <p className="py-8 text-center text-xs opacity-60">暂无产品主图</p> : null}
                    <div className={`${styles.gallery} guan-scroll-region thin-scrollbar`}>
                        {images.map((image, index) => {
                            const owner = variantImageOwner(draft, image.id);
                            const shared = draft.sharedImageIds.includes(image.id);
                            const localSingle = mode === "single" && Boolean(owner && draft.addedByImage[image.id] === owner.id);
                            const checked = localSingle || mode === "group" && selection.includes(image.id);
                            const disabled = shared || Boolean(owner && !localSingle);
                            return <Tooltip key={image.id} title={shared ? "共用图片，供各变体共同参考" : owner && !localSingle ? `已分配给“${variantLabel(owner)}”` : image.name}>
                                <button type="button" className={styles.image} aria-label={`选择产品图片 ${index + 1} ${image.name}`}
                                    aria-pressed={Boolean(checked)} disabled={disabled} onClick={() => select(image.id)}>
                                    <span className={styles.imageFrame}
                                        style={{ background: ctx.theme.toolbar.itemHover, opacity: disabled ? 0.6 : 1, borderColor: checked ? "#2684ff" : undefined }}>
                                        <MediaThumbnail storageKey={image.storageKey} fallback={image.url} alt={image.name} className={styles.thumbnail} />
                                        <ImageUploadNumber number={index + 1} />
                                        <span aria-hidden className={`absolute right-1 top-1 grid size-5 place-items-center rounded border ${checked ? "border-blue-500 bg-blue-500 text-white" : "border-black/20 bg-white"}`}>
                                            {checked ? <Check className="size-3.5" /> : null}
                                        </span>
                                    </span>
                                    <span className="mt-1 block truncate text-xs">{image.name}</span>
                                    <span className="block truncate text-[10px] opacity-60">{shared ? "共用图片" : owner ? variantLabel(owner) : "未分配"}</span>
                                </button>
                            </Tooltip>;
                        })}
                    </div>
                    {mode === "group" && selection.length > 0 ? <div className="shrink-0 border-t pt-3">
                        <Button type="primary" block icon={<Plus className="size-4" />} onClick={() => {
                            setDraft(previous => addVariantGroup(previous, selection, latest.current.getNode(ctx.node.id)?.metadata || {}));
                            setSelection([]); setError("");
                        }}>添加变体 · {selection.length} 张图片</Button>
                    </div> : null}
                </section>
                <section aria-label="变体编辑列表" className={`${styles.variants} guan-scroll-region thin-scrollbar`}>
                    <div className="mb-3 text-sm font-medium">变体 {draft.variants.length}</div>
                    <div className="mb-3 flex flex-wrap items-center gap-1">
                        {draft.attributes.map(name => <span key={name} className="flex items-center gap-1 rounded bg-black/[.04] py-1 pl-2 pr-1 text-xs dark:bg-white/[.06]">
                            {name}<Tooltip title={`移除属性 ${name}`}><button type="button" aria-label={`移除管理属性 ${name}`} className="grid size-5 place-items-center" onClick={() => {
                                setDraft(previous => ({ ...previous, attributes: previous.attributes.filter(field => field !== name),
                                    variants: previous.variants.map(variant => ({ ...variant, attributes: Object.fromEntries(Object.entries(variant.attributes).filter(([key]) => key !== name)) })) }));
                            }}><X className="size-3" /></button></Tooltip>
                        </span>)}
                        <form className="flex min-w-0 items-center gap-1" onSubmit={event => {
                            event.preventDefault(); const name = attribute.trim();
                            if (name) setDraft(previous => previous.attributes.includes(name) ? previous : { ...previous, attributes: [...previous.attributes, name] });
                            setAttribute("");
                        }}>
                            <Tooltip title="添加颜色、尺寸、数量、款式等变体属性" trigger={["hover", "focus"]}>
                                <input aria-label="管理面板新属性" className={`${inputClass} !w-28`} style={style} placeholder="添加属性" value={attribute} onChange={event => setAttribute(event.target.value)} />
                            </Tooltip>
                            <Tooltip title="添加属性"><button type="submit" aria-label="添加管理属性" className="grid size-8 place-items-center"><Plus className="size-4" /></button></Tooltip>
                        </form>
                    </div>
                    {!draft.variants.length ? <p className="py-10 text-center text-xs opacity-60">暂无变体</p> : null}
                    <div className="divide-y" style={style}>
                        {draft.variants.map(variant => {
                            const primary = images.find(image => image.id === (variant.primaryImageId || variant.imageIds[0]));
                            return <article key={variant.id} data-manager-variant-id={variant.id} className="min-w-0 py-4 first:pt-0">
                            <div className={styles.variantRow}>
                                <Checkbox aria-label={`启用变体 ${variantLabel(variant)}`} checked={variant.enabled} onChange={event => edit(variant.id, "enabled", event.target.checked)} />
                                <span className={styles.primaryImage} style={{ background: ctx.theme.toolbar.itemHover }}>
                                    {primary ? <MediaThumbnail storageKey={primary.storageKey} fallback={primary.url} alt={`${variantLabel(variant)} 主参考图`} className={styles.thumbnail} />
                                        : <span className="grid h-full place-items-center text-[10px] opacity-50">未配图</span>}
                                </span>
                                <label className="min-w-0 flex-1 text-[11px]">变体名称
                                    <Tooltip title="填写本销售款式的名称，生成时用来区分不同变体" trigger={["hover", "focus"]}>
                                        <input aria-label={`变体管理名称 ${variant.id}`} value={variant.name} className={`${inputClass} mt-1`} style={style}
                                            onChange={event => edit(variant.id, "name", event.target.value)} />
                                    </Tooltip>
                                    <span className="mt-1 block text-[10px] opacity-55">{variant.imageIds.length} 张图片</span>
                                </label>
                                <Popconfirm title="移除这个变体？" description="产品主图和已生成结果保留，保存后生效。" onConfirm={() => setDraft(previous => removeDraftVariant(previous, variant.id))}>
                                    <Tooltip title="移除变体"><button type="button" aria-label={`移除管理变体 ${variantLabel(variant)}`} className="grid size-8 place-items-center"><Trash2 className="size-4" /></button></Tooltip>
                                </Popconfirm>
                            </div>
                            {variant.imageIds.length > 1 ? <div className={`${styles.imageStrip} guan-scroll-region thin-scrollbar`}>
                                {variant.imageIds.map(id => {
                                    const image = images.find(item => item.id === id);
                                    return image ? <Tooltip key={id} title={variant.primaryImageId === id ? "主参考图" : "设为主参考图"}>
                                        <button type="button" aria-label={`设为主参考图 ${variantLabel(variant)} ${image.name}`} onClick={() => edit(variant.id, "primary", id)}
                                            className={styles.extraImage} style={{ borderColor: variant.primaryImageId === id ? "#2684ff" : undefined }}>
                                            <MediaThumbnail storageKey={image.storageKey} fallback={image.url} alt={image.name} className={styles.thumbnail} />
                                        </button>
                                    </Tooltip> : <span key={id} className="text-xs text-red-600">图片已移除</span>;
                                })}
                            </div> : null}
                            <div className={styles.attributes}>
                                {draft.attributes.map(name => <label key={name} className="block min-w-0 text-[11px]">{name}
                                    <Tooltip title={`填写本变体的${name}，留空沿用共用资料。`} trigger={["hover", "focus"]}>
                                        <input aria-label={`管理属性 ${variant.id} ${name}`} value={variant.attributes[name] || ""} className={`${inputClass} mt-1`} style={style}
                                            onChange={event => edit(variant.id, "attribute", event.target.value, name)} />
                                    </Tooltip>
                                </label>)}
                            </div>
                        </article>;
                        })}
                    </div>
                </section>
            </div>
            {error ? <p role="alert" className="mt-3 text-xs text-red-600">{error}</p> : null}
            <div className={styles.footer}>
                <span className="mr-auto text-xs opacity-60">共 {draft.variants.length} 个变体 · 已选 {draft.variants.filter(variant => variant.enabled).length} 个</span>
                <Button onClick={onClose}>取消</Button><Button type="primary" onClick={save}>保存</Button>
            </div>
        </div>
    </Modal>;
}
