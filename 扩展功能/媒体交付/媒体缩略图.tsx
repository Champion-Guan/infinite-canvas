import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ImageIcon } from "lucide-react";
import { resolveCanvasImageSource } from "@/services/image-storage";

export function MediaThumbnail({ storageKey, fallback, alt = "", className, style, maxEdge = 192 }: {
    storageKey?: string; fallback?: string; alt?: string; className?: string; style?: CSSProperties; maxEdge?: 192 | 768;
}) {
    const holder = useRef<HTMLSpanElement>(null);
    const [loaded, setLoaded] = useState<{ key: string; source?: string }>();
    const key = storageKey || fallback || "";
    const fallbackSource = fallback?.startsWith("blob:guan-deferred:") ? undefined : fallback;
    useEffect(() => {
        const element = holder.current;
        if (!element || !key) return;
        let active = true;
        const load = () => {
            observer?.disconnect();
            if (!storageKey) { setLoaded({ key, source: fallbackSource }); return; }
            void resolveCanvasImageSource(storageKey, maxEdge).then(source => {
                if (active) setLoaded({ key, source: source || fallbackSource });
            }).catch(() => { if (active) setLoaded({ key, source: fallbackSource }); });
        };
        const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) load();
        }, { rootMargin: "160px" });
        if (observer) observer.observe(element);
        else load();
        return () => { active = false; observer?.disconnect(); };
    }, [key, storageKey, fallbackSource, maxEdge]);
    const source = loaded?.key === key ? loaded.source : undefined;
    return (
        <span ref={holder} className={className} style={{ ...style, display: "inline-grid", overflow: "hidden" }}>
            {source
                ? <img src={source} alt={alt} loading="lazy" decoding="async" className={className} style={{ width: "100%", height: "100%" }} />
                : <ImageIcon aria-label={alt || undefined} className="m-auto size-4 opacity-35" />}
        </span>
    );
}
