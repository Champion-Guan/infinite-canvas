import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { AppleModal as Modal } from "../主题/苹果弹窗";
import { LoaderCircle, Plus, RotateCcw, Scissors, X } from "lucide-react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { useAssetStore } from "@/stores/use-asset-store";
import { ASSET_DRAG_TYPE, readAssetDrag } from "../素材/上传资产规则";
import { ParameterImageThumbnail } from "./参数图片预览";
import { applyProductImageCutout, productMainImages, productMainImagesPatch, productImageSource, restoreProductMainImage,
    sameProductImageSource, type ProductImageMetadata, type ProductMainImage } from "./产品主图规则";

export function ProductMainImageUploader({ ctx, productId }: { ctx: CanvasNodeContext; productId: string }) {
    const images = productMainImages(ctx.node.metadata as ProductImageMetadata);
    const input = useRef<HTMLInputElement>(null);
    const latest = useRef(ctx);
    latest.current = ctx;
    const lifetime = useRef<AbortController | null>(null);
    const uploading = useRef(false);
    const uploadQueue = useRef<File[]>([]);
    const dragDepth = useRef(0);
    const flights = useRef(new Set<string>());
    const [dragging, setDragging] = useState(false);
    const [progress, setProgress] = useState("");
    const [busy, setBusy] = useState<string[]>([]);
    const [error, setError] = useState("");
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const theme = ctx.theme;
    useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        return () => { controller.abort(); uploadQueue.current = []; };
    }, [ctx.node.id, productId]);

    const updateImages = (change: (current: ProductMainImage[]) => ProductMainImage[]) => {
        const current = latest.current.getNode(ctx.node.id);
        if (!current) return;
        latest.current.updateMetadata(productMainImagesPatch(change(productMainImages(current.metadata as ProductImageMetadata))));
    };
    const upload = async (files: File[]) => {
        const signal = lifetime.current?.signal;
        if (!files.length || !signal || signal.aborted) return;
        uploadQueue.current.push(...files);
        if (uploading.current) return;
        uploading.current = true;
        setProgress("正在上传");
        setError("");
        const failures: string[] = [];
        try {
            const { uploadImage } = await import("@/services/image-storage");
            let completed = 0;
            while (uploadQueue.current.length) {
                if (signal.aborted || !latest.current.getNode(ctx.node.id)) break;
                const file = uploadQueue.current.shift()!;
                setProgress(`正在上传 ${++completed}/${completed + uploadQueue.current.length}`);
                try {
                    if (!file.type?.startsWith("image/") && !/\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(file.name)) {
                        throw new Error("请选择图片文件");
                    }
                    const image = await uploadImage(file, { assetProjectId: productId, signal });
                    signal.throwIfAborted();
                    updateImages(current => [...current, { ...productImageSource(image), id: crypto.randomUUID(), name: file.name }]);
                } catch (failure) {
                    if (signal.aborted) break;
                    failures.push(`${file.name}：${failure instanceof Error ? failure.message : "上传失败"}`);
                }
            }
            if (!signal.aborted) setError(failures.join("\n"));
        } catch (failure) {
            if (!signal.aborted) setError(failure instanceof Error ? failure.message : "图片上传失败");
        } finally {
            uploading.current = false;
            uploadQueue.current = [];
            if (!signal.aborted) setProgress("");
        }
    };
    const acceptsDrop = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types)
        .some(type => type === "Files" || type === ASSET_DRAG_TYPE);
    const drop = (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
            const assetId = readAssetDrag(event.dataTransfer.getData(ASSET_DRAG_TYPE), productId);
            const asset = useAssetStore.getState().assets.find(item => item.id === assetId);
            if (!asset || asset.metadata?.projectId && asset.metadata.projectId !== productId) {
                setError("该图片资产已移除或属于其他产品，请重新选择。");
            } else if (asset.kind !== "image") {
                setError("产品主图仅支持图片资产。");
            } else {
                const source = productImageSource({ ...asset.data, url: asset.data.dataUrl });
                setError("");
                updateImages(current => current.some(image => sameProductImageSource(image, source)) ? current
                    : [...current, { ...source, id: crypto.randomUUID(), name: asset.title }]);
            }
            return;
        }
        const files = Array.from(event.dataTransfer.files);
        if (files.length) void upload(files);
        else setError("请拖入本地图片文件或左侧图片资产。");
    };
    const removeBackground = async (id: string) => {
        setConfirmId(null);
        const signal = lifetime.current?.signal;
        if (!signal || signal.aborted || flights.current.has(id)) return;
        flights.current.add(id);
        setBusy([...flights.current]);
        setError("");
        try {
            const { removeProductMainImageBackground } = await import("./产品主图去背景");
            await removeProductMainImageBackground({ ctx: latest.current, productId, imageId: id, signal });
        } catch (failure) {
            if (!signal.aborted) setError(`移除背景未完成，原图已保留：${failure instanceof Error ? failure.message : "请重试"}`);
        } finally {
            flights.current.delete(id);
            if (!signal.aborted) setBusy([...flights.current]);
        }
    };
    const toggleBackground = (image: ProductMainImage) => {
        if (image.backgroundRemoved) {
            updateImages(current => current.map(item => item.id === image.id ? restoreProductMainImage(item) : item));
        } else if (image.cutout) {
            updateImages(current => current.map(item => item.id === image.id ? applyProductImageCutout(item, item.cutout!) : item));
        } else setConfirmId(image.id);
    };

    return (
        <section aria-label="产品主图" data-product-image-drop-zone data-drag-active={dragging || undefined}
            className={`relative space-y-2 rounded-lg border-2 p-2 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${dragging ? "border-blue-500 bg-blue-500/10" : "border-transparent"}`}
            onDragEnter={event => {
                event.stopPropagation();
                if (!acceptsDrop(event)) return;
                event.preventDefault();
                dragDepth.current++;
                setDragging(true);
            }}
            onDragOver={event => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = acceptsDrop(event) ? "copy" : "none";
            }}
            onDragLeave={event => {
                event.stopPropagation();
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (!dragDepth.current) setDragging(false);
            }}
            onDrop={drop}>
            <div className="flex items-center gap-2 text-[11px]">
                <span className="font-medium">产品主图</span>
                {images.length ? <span className="opacity-55">{images.length} 张</span> : null}
            </div>
            <input ref={input} aria-label="上传产品主图" type="file" multiple accept="image/*,.heic,.heif" className="hidden"
                onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void upload(files); }} />
            <div className="grid grid-cols-3 gap-2">
                {images.map((image, index) => {
                    const pending = busy.includes(image.id);
                    const label = `${index + 1}：${image.name}`;
                    return (
                        <div key={image.id} className="group/product-image relative aspect-square min-w-0 overflow-hidden rounded-lg border"
                            style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }}>
                            <ParameterImageThumbnail image={image} name={`产品主图 ${label}`} className="block h-full min-h-0 w-full min-w-0" />
                            <button type="button" aria-label={`移除产品主图 ${label}`} title="移除图片" disabled={pending}
                                className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-white/95 text-stone-900 opacity-0 shadow-sm transition-opacity group-hover/product-image:opacity-100 group-focus-within/product-image:opacity-100 disabled:cursor-wait motion-reduce:transition-none [@media(hover:none)]:opacity-100"
                                onClick={() => updateImages(current => current.filter(item => item.id !== image.id))}><X className="size-3" /></button>
                            <button type="button" aria-label={`${image.backgroundRemoved ? "还原" : "移除背景"} 产品主图 ${label}`}
                                title={image.backgroundRemoved ? "还原原图" : "移除背景"} disabled={pending} aria-busy={pending}
                                className={`absolute bottom-1 left-1 right-1 flex min-h-6 items-center justify-center gap-1 rounded-md bg-black/75 px-1 py-1 text-[10px] leading-4 text-white transition-opacity group-hover/product-image:opacity-100 group-focus-within/product-image:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100 ${pending ? "opacity-100" : "opacity-0"}`}
                                style={{ color: "#fff", fontSize: 10 }}
                                onClick={() => toggleBackground(image)}>
                                {pending ? <LoaderCircle className="size-3 shrink-0 animate-spin motion-reduce:animate-none" /> : image.backgroundRemoved ? <RotateCcw className="size-3 shrink-0" /> : <Scissors className="size-3 shrink-0" />}
                                {pending ? "处理中…" : image.backgroundRemoved ? "还原" : "移除背景"}
                            </button>
                        </div>
                    );
                })}
                <button type="button" aria-label="上传产品主图" disabled={Boolean(progress)} onClick={() => input.current?.click()}
                    className="flex aspect-square min-w-0 flex-col items-center justify-center gap-2 rounded-lg border text-[11px] transition-colors hover:bg-black/[.04] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait motion-reduce:transition-none dark:hover:bg-white/[.06]"
                    style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover, color: theme.node.text }}>
                    <span className="grid size-8 place-items-center rounded-lg bg-black/[.04] dark:bg-white/[.06]">
                        {progress ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Plus className="size-5" />}
                    </span>
                    <span className="opacity-65">{dragging ? "松开添加" : progress ? "上传中…" : "上传图片"}</span>
                </button>
            </div>
            <div role="status" aria-live="polite" className={progress ? "text-[10px] opacity-60" : "sr-only"}>{progress}</div>
            {error ? <div role="alert" className="whitespace-pre-line break-words text-[10px] text-red-600 dark:text-red-400">{error}</div> : null}
            <Modal title="移除背景？" open={confirmId !== null} onCancel={() => setConfirmId(null)} okText="移除背景" cancelText="取消"
                onOk={() => { if (confirmId) void removeBackground(confirmId); }} destroyOnHidden>
                <p>使用当前配置的生图渠道处理这张图片，可能产生费用。原图会保留，可随时还原。</p>
            </Modal>
        </section>
    );
}
