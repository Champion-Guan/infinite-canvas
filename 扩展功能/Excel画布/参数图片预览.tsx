import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Image, Spin } from "antd";
import { MediaThumbnail } from "../媒体交付/媒体缩略图";
import { readDownloadBlob } from "../画布迁移扩展/media-download";
import { createProductPortal, useProductActive } from "../产品/产品界面边界";
import type { ProductImageSource } from "./产品主图规则";
import { ImageUploadNumber } from "../媒体交付/图片上传编号";
import { ImageReferenceHoverPreview } from "./图片引用悬浮预览";

export function ParameterImageThumbnail({ image, name, className, style, number, children, hoverPreview = false }: {
    image: ProductImageSource;
    name: string;
    className?: string;
    style?: CSSProperties;
    number?: number;
    children?: ReactNode;
    hoverPreview?: boolean;
}) {
    const active = useProductActive();
    const [open, setOpen] = useState(false);
    const [requested, setRequested] = useState(false);
    const [preview, setPreview] = useState<{ key: string; url?: string; error?: string }>();
    const key = `${image.storageKey || ""}\n${image.url || ""}`;
    const current = preview?.key === key ? preview : undefined;
    useEffect(() => {
        if (!requested || !active) return;
        let alive = true, url: string | undefined;
        setPreview(undefined);
        void readDownloadBlob({ kind: "image", storageKey: image.storageKey, url: image.url }).then(blob => {
            if (!alive) return;
            url = URL.createObjectURL(blob);
            setPreview({ key, url });
        }).catch(error => {
            if (alive) setPreview({ key, error: error instanceof Error ? error.message : "图片读取失败，请关闭后重试" });
        });
        return () => { alive = false; if (url) URL.revokeObjectURL(url); };
    }, [requested, active, key, image.storageKey, image.url]);
    useEffect(() => {
        if (!active) { setOpen(false); setRequested(false); }
    }, [active]);
    const button = <button type="button" aria-label={`放大查看 ${name}`} title={hoverPreview ? undefined : "放大查看"} className={className}
        style={{ ...style, position: "relative", cursor: "zoom-in" }}
        onPointerDown={event => event.stopPropagation()}
        onMouseDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); setRequested(true); setOpen(true); }}>
        {children || <MediaThumbnail storageKey={image.storageKey} fallback={image.url} alt={name}
            className="h-full min-h-0 w-full min-w-0 object-contain"
            style={{ gridTemplateRows: "minmax(0, 1fr)", gridTemplateColumns: "minmax(0, 1fr)" }} />}
        <ImageUploadNumber number={number} />
    </button>;
    return (
        <span style={{ display: "contents" }} data-canvas-shortcuts-ignore
            onPointerDown={event => event.stopPropagation()}
            onMouseDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}>
            {hoverPreview ? <ImageReferenceHoverPreview content={<div data-image-reference-preview data-image-width={image.width} data-image-height={image.height}>
                <p data-reference-preview-caption className="line-clamp-2 break-words text-xs leading-4" style={{ margin: "0 0 4px", lineHeight: "16px", textAlign: "left", textIndent: 0 }} title={name}>{name}</p>
                <div style={{ width: "var(--reference-preview-width)", height: "var(--reference-preview-height)" }}><MediaThumbnail storageKey={image.storageKey} fallback={image.url} alt={name}
                    className="h-full min-h-0 w-full min-w-0 object-contain"
                    style={{ display: "grid", gridTemplateRows: "minmax(0, 1fr)", gridTemplateColumns: "minmax(0, 1fr)" }} /></div>
            </div>}>{button}</ImageReferenceHoverPreview> : button}
            {requested ? createProductPortal(<Image src={current?.url} alt={name} styles={{ root: { display: "none" } }}
                preview={{
                    open: active && open,
                    onOpenChange: next => setOpen(next),
                    afterOpenChange: visible => { if (!visible) { setRequested(false); setPreview(undefined); } },
                    imageRender: original => current?.url ? original : (
                        <div className="grid min-h-32 place-items-center px-8 text-center text-white" data-canvas-shortcuts-ignore>
                            {current?.error ? <p role="alert">{current.error}</p> : <Spin aria-label="正在读取原图" />}
                        </div>
                    ),
                    actionsRender: original => current?.url ? original : null,
                }} />, document.body) : null}
        </span>
    );
}
