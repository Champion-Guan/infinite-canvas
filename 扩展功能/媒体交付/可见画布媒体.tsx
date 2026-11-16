import { useEffect, useRef, type RefObject } from "react";
import type { CanvasNodeData } from "@/types/canvas";
import { hasDeferredCanvasMedia as hasDeferredMedia, restoreCanvasMedia, retainCanvasMedia } from "../本机存储/画布媒体延迟恢复.mjs";
import { markWorkbenchStartup } from "../本机存储/启动计时.mjs";

export const hasDeferredCanvasMedia = (value: unknown) => hasDeferredMedia(value, { ignoreKeyedImageUrls: true, deferImageNodes: true });

export function useVisibleCanvasMedia({
    projectId, snapshot, nodesRef, visibleNodes, ready, interacting = false, setNodes, onError,
}: {
    projectId: string; snapshot: unknown; nodesRef: RefObject<CanvasNodeData[]>;
    visibleNodes: CanvasNodeData[]; ready: boolean; interacting?: boolean;
    setNodes: (value: CanvasNodeData[]) => void;
    onError: (message: string) => void;
}) {
    const firstPaintMeasured = useRef(false);
    useEffect(() => retainCanvasMedia(snapshot), [projectId, snapshot]);
    useEffect(() => {
        if (!ready || interacting) return;
        let active = true, frame = 0, releaseFrame: (() => void) | undefined;
        const waiting = visibleNodes.filter(node => hasDeferredCanvasMedia(node));
        if (!waiting.length) { markWorkbenchStartup("visible-media-ready"); return; }
        void (async () => {
            for (let index = 0; active && index < waiting.length; index += 4) {
                const batch = waiting.slice(index, index + 4);
                const restored = await restoreCanvasMedia(batch, { deferKeyedImageUrls: true, deferImageNodes: true });
                if (!active) return;
                const originals = new Map(batch.map(node => [node.id, node]));
                const results = new Map(restored.map(node => [node.id, node]));
                const current = nodesRef.current;
                setNodes(current.map(node => originals.get(node.id) === node ? results.get(node.id)! : node));
                // 每批让出一帧；新手势或视区变化后不再读取旧批次。
                await new Promise<void>(resolve => {
                    releaseFrame = resolve;
                    frame = requestAnimationFrame(() => { releaseFrame = undefined; resolve(); });
                });
            }
        })().then(() => {
            if (active) markWorkbenchStartup("visible-media-ready");
        }).catch(error => {
            if (active && waiting.some(node => nodesRef.current.includes(node)))
                onError(error instanceof Error ? error.message : "图片读取失败，请重试恢复画布。");
        });
        return () => { active = false; cancelAnimationFrame(frame); releaseFrame?.(); };
    }, [visibleNodes, ready, interacting, nodesRef, setNodes, onError]);
    useEffect(() => {
        if (!ready || interacting || firstPaintMeasured.current || !visibleNodes.length
            || visibleNodes.some(node => hasDeferredCanvasMedia(node))) return;
        let frame = 0, active = true;
        const cleanups: Array<() => void> = [];
        const inspect = () => {
            const viewport = document.querySelector('[data-product-active="true"] .guan-canvas-viewport');
            if (!viewport) return;
            const bounds = viewport.getBoundingClientRect();
            const images = [...viewport.querySelectorAll('img')].filter(image => {
                const rect = image.getBoundingClientRect();
                return rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom;
            });
            const finish = () => {
                if (!active || images.some(image => !image.complete)) return;
                firstPaintMeasured.current = true;
                markWorkbenchStartup(images.some(image => !image.naturalWidth) ? "visible-images-failed" : "visible-images-painted");
            };
            for (const image of images) if (!image.complete) {
                image.addEventListener("load", finish); image.addEventListener("error", finish);
                cleanups.push(() => { image.removeEventListener("load", finish); image.removeEventListener("error", finish); });
            }
            frame = requestAnimationFrame(finish);
        };
        frame = requestAnimationFrame(inspect);
        return () => { active = false; cancelAnimationFrame(frame); cleanups.forEach(cleanup => cleanup()); };
    }, [visibleNodes, ready, interacting]);
}

export function CanvasMediaPlaceholder({ node }: { node: CanvasNodeData }) {
    return <div role="status" aria-label={`正在读取${node.title || "图片"}`}
        style={{ position: "absolute", left: node.position.x, top: node.position.y, width: node.width, height: node.height,
            borderRadius: 8, background: "var(--muted)", display: "grid", placeItems: "center", border: "1px solid var(--border)" }}>
        <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40 motion-reduce:animate-none" />
    </div>;
}
