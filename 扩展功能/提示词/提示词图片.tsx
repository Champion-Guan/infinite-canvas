import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { Image as ImageIcon, LoaderCircle } from "lucide-react";
import { Image } from "antd";
import { readPromptImage } from "./提示词远程图片";

export function PromptImage({ src = "", alt = "", className, style, loading = "lazy", preview = false, ...props }:
    ImgHTMLAttributes<HTMLImageElement> & { preview?: boolean }) {
    const frame = useRef<HTMLSpanElement>(null);
    const [visible, setVisible] = useState(loading === "eager");
    const [image, setImage] = useState<{ source: string; url?: string; failed?: boolean }>({ source: "" });
    const remote = /^https?:\/\//i.test(src);
    useEffect(() => {
        if (loading === "eager" || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
        const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
        if (frame.current) observer.observe(frame.current);
        return () => observer.disconnect();
    }, [loading]);
    useEffect(() => {
        if (!remote || !visible) return;
        let disposed = false, objectUrl: string | undefined;
        const controller = new AbortController();
        setImage({ source: src });
        void readPromptImage(src, controller.signal).then(blob => {
            if (disposed) return;
            objectUrl = URL.createObjectURL(blob);
            setImage({ source: src, url: objectUrl });
        }).catch(() => { if (!disposed) setImage({ source: src, failed: true }); });
        return () => { disposed = true; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [src, remote, visible]);
    const url = remote ? visible && image.source === src ? image.url : undefined : src;
    const failed = visible && image.source === src && image.failed;
    return <span ref={frame} className={`relative block overflow-hidden ${className || ""}`} style={style}>
        {url && !failed ? preview ? <Image src={url} alt={alt} width="100%" height="100%"
            style={{ objectFit: "contain" }} preview={{ src: url }}
            onError={() => setImage({ source: src, failed: true })} /> : <img {...props} src={url} alt={alt} loading={loading} className="block h-full w-full object-cover"
            onError={event => { setImage({ source: src, failed: true }); props.onError?.(event); }} />
            : <span className="grid h-full min-h-10 w-full place-items-center bg-black/5 text-current dark:bg-white/5">
                {failed ? <ImageIcon aria-label="图片加载失败" className="size-4 opacity-40" />
                    : visible ? <LoaderCircle aria-label="正在加载图片" className="size-4 animate-spin opacity-40 motion-reduce:animate-none" />
                    : <ImageIcon aria-hidden className="size-4 opacity-30" />}
            </span>}
    </span>;
}
