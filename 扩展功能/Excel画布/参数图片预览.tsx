import { useEffect, useState, type CSSProperties } from "react";
import { Image, Spin } from "antd";
import { MediaThumbnail } from "../媒体交付/媒体缩略图";
import { readDownloadBlob } from "../画布迁移扩展/media-download";
import { useProductActive } from "../产品/产品界面边界";
import type { ProductImageSource } from "./产品主图规则";

export function ParameterImageThumbnail({ image, name, className, style }: {
    image: ProductImageSource;
    name: string;
    className?: string;
    style?: CSSProperties;
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
    return (
        <div style={{ display: "contents" }} data-canvas-shortcuts-ignore
            onPointerDown={event => event.stopPropagation()}
            onMouseDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}>
            <button type="button" aria-label={`放大查看 ${name}`} title="放大查看" className={className}
                style={{ ...style, cursor: "zoom-in" }}
                onPointerDown={event => event.stopPropagation()}
                onMouseDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); setRequested(true); setOpen(true); }}>
                <MediaThumbnail storageKey={image.storageKey} fallback={image.url} alt={name}
                    className="h-full min-h-0 w-full min-w-0 object-contain"
                    style={{ gridTemplateRows: "minmax(0, 1fr)", gridTemplateColumns: "minmax(0, 1fr)" }} />
            </button>
            <Image src={current?.url} alt={name} styles={{ root: { display: "none" } }}
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
                }} />
        </div>
    );
}
