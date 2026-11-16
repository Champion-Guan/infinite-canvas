import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getImagePreviewRevision, resolveCanvasImageSource, resolveImageUrl, subscribeImagePreviews } from "@/services/image-storage";
import { createPreviewReadQueue } from "./缩略图读取队列";
import { createImageHandoff, decodeImageSource, validImageSource } from "./图片解码交接";
import { isEmbeddedCanvasImage, resolveEmbeddedCanvasPreview } from "./画布内嵌图片预览";

const prepareImage = createPreviewReadQueue(4);

export function useResidentCanvasImage(storageKey: string | undefined, fallback: string | undefined, longEdge: number) {
    const source = validImageSource(fallback), key = storageKey || fallback || "";
    const revision = useSyncExternalStore(
        useCallback((listener: () => void) => subscribeImagePreviews(listener, storageKey), [storageKey]),
        useCallback(() => getImagePreviewRevision(storageKey), [storageKey]));
    const edge = longEdge > 768 ? Infinity : longEdge > 192 ? 768 : 192;
    const [shown, setShown] = useState<ReturnType<ReturnType<typeof createImageHandoff>["current"]>>();
    const handoff = useRef<ReturnType<typeof createImageHandoff> | null>(null);
    if (!handoff.current) handoff.current = createImageHandoff();
    const requestedEdge = useRef(edge);
    requestedEdge.current = edge;
    const request = useRef<((edge: number) => void) | undefined>(undefined);
    useEffect(() => {
        if (!key) return;
        const state = handoff.current!;
        const embedded = isEmbeddedCanvasImage(fallback);
        let active = true, pending = false, desired = requestedEdge.current;
        const pump = () => {
            if (!active || pending) return;
            const current = state.current();
            // 首次先交付轻量预览。快速改倍率只更新目标，不取消同一原件的在途读取。
            const target = current?.key === key ? Math.max(desired, current.edge) : storageKey || embedded ? 192 : desired;
            const next = state.prepare(key, target, revision);
            if (!next) return;
            pending = true;
            let accepted = false;
            void prepareImage(async () => {
                if (!active) return;
                const resolved = embedded ? await resolveEmbeddedCanvasPreview(fallback, next.edge) : storageKey ? next.edge === Infinity
                    ? await resolveImageUrl(storageKey)
                    : await resolveCanvasImageSource(storageKey, next.edge) : source;
                const candidate = validImageSource(resolved) || await resolveEmbeddedCanvasPreview(fallback, next.edge) || source;
                if (!active || !candidate) return;
                await decodeImageSource(candidate);
                if (!active) return;
                const ready = next.accept(candidate);
                if (ready) { accepted = true; setShown(ready); }
            }).catch(() => {}).finally(() => {
                pending = false;
                if (active && accepted && desired > next.edge) pump();
            });
        };
        const update = (value: number) => { desired = value; pump(); };
        request.current = update;
        pump();
        return () => {
            active = false; state.cancel();
            if (request.current === update) request.current = undefined;
        };
    }, [key, storageKey, source, fallback, revision]);
    useEffect(() => { request.current?.(edge); }, [edge]);
    return shown?.key === key ? shown.source : undefined;
}
