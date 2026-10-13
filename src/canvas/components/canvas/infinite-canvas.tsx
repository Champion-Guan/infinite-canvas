import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createCanvasPanScheduler } from "@/lib/canvas/canvas-pan-scheduler";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "@/types/canvas";

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    tool: "select" | "pan";
    backgroundMode?: CanvasBackgroundMode;
    onViewportChange: (viewport: ViewportTransform) => void;
    onViewportPreview?: (viewport: ViewportTransform) => void;
    onPanningChange?: (panning: boolean) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
};

export function InfiniteCanvas({ containerRef, viewport, tool, backgroundMode = "lines", onViewportChange, onViewportPreview, onPanningChange, onCanvasMouseDown, onCanvasDeselect, onCanvasDoubleClick, onContextMenu, onDrop, children }: InfiniteCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const panState = useRef({
        isPanning: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
        startedOnBackground: false,
    });
    const scaleRef = useRef(viewport.k);
    const liveViewportRef = useRef(viewport);
    const zoomingRef = useRef(false);
    const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const callbacksRef = useRef({ onViewportChange, onViewportPreview, onPanningChange, onCanvasDeselect });
    callbacksRef.current = { onViewportChange, onViewportPreview, onPanningChange, onCanvasDeselect };
    const schedulerRef = useRef<ReturnType<typeof createCanvasPanScheduler> | null>(null);
    if (!schedulerRef.current) schedulerRef.current = createCanvasPanScheduler({
        paint: next => {
            const scaleChanged = scaleRef.current !== next.k;
            liveViewportRef.current = next;
            scaleRef.current = next.k;
            if (layerRef.current) layerRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.k})`;
            if (gridRef.current) {
                gridRef.current.style.backgroundPosition = `${next.x % (48 * next.k)}px ${next.y % (48 * next.k)}px`;
                gridRef.current.style.backgroundSize = `${48 * next.k}px ${48 * next.k}px`;
            }
            if (scaleChanged) layerRef.current?.querySelectorAll<HTMLElement>("[data-node-panel]").forEach(panel => {
                panel.style.transform = `translateX(-50%) scale(${1 / next.k})`;
            });
            callbacksRef.current.onViewportPreview?.(next);
        },
        commit: next => callbacksRef.current.onViewportChange(next),
        frame: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id), now: () => performance.now(),
        extent: () => ({ width: containerRef.current?.clientWidth || 0, height: containerRef.current?.clientHeight || 0 }),
    });
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isControlPressed, setIsControlPressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);

    useEffect(
        () => () => {
            schedulerRef.current?.dispose();
            if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
        },
        [],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Control") setIsControlPressed(true);
            if (event.code !== "Space") return;
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true']")) return;
            event.preventDefault();
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") {
                const target = event.target instanceof Element ? event.target : null;
                if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true']"))) event.preventDefault();
                setIsSpacePressed(false);
            }
            if (event.key === "Control") setIsControlPressed(false);
        };

        const handleBlur = () => {
            setIsSpacePressed(false);
            setIsControlPressed(false);
            if (panState.current.isPanning || zoomingRef.current) schedulerRef.current?.flush();
            zoomingRef.current = false;
            if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
            panState.current.isPanning = false;
            callbacksRef.current.onPanningChange?.(false);
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, []);

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;

        const current = panState.current.isPanning || zoomingRef.current ? schedulerRef.current?.latest || liveViewportRef.current : viewport;
        if (panState.current.isPanning) {
            panState.current.isPanning = false;
            document.body.style.cursor = "";
        }
        const delta = -event.deltaY;
        const factor = Math.pow(1.1, delta / 100);
        const newScale = Math.min(Math.max(current.k * factor, 0.05), 5);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const worldX = (mouseX - current.x) / current.k;
        const worldY = (mouseY - current.y) / current.k;

        if (!zoomingRef.current) {
            schedulerRef.current?.begin(current);
            zoomingRef.current = true;
            setIsPanning(true);
            callbacksRef.current.onPanningChange?.(true);
        }
        const next = {
            x: mouseX - worldX * newScale,
            y: mouseY - worldY * newScale,
            k: newScale,
        };
        liveViewportRef.current = next;
        schedulerRef.current?.move(next);
        if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
        zoomTimerRef.current = setTimeout(() => {
            schedulerRef.current?.flush();
            zoomingRef.current = false;
            callbacksRef.current.onPanningChange?.(false);
            setIsPanning(false);
        }, 120);
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom]")) return;
        if (target?.closest("[data-connection-create-menu]")) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");
        const temporaryTool = event.ctrlKey || isSpacePressed;
        const activeTool = temporaryTool ? (tool === "select" ? "pan" : "select") : tool;
        const shouldPan = event.button === 1 || (event.button === 0 && activeTool === "pan" && isBackgroundClick);

        if (shouldPan) {
            const start = zoomingRef.current ? schedulerRef.current?.flush() || viewport : viewport;
            zoomingRef.current = false;
            if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            panState.current = {
                isPanning: true,
                startX: event.clientX,
                startY: event.clientY,
                initialX: start.x,
                initialY: start.y,
                hasMoved: false,
                startedOnBackground: isBackgroundClick,
            };
            setIsPanning(true);
            schedulerRef.current?.begin(start);
            callbacksRef.current.onPanningChange?.(true);
            document.body.style.cursor = "grabbing";
            return;
        }

        if (event.button === 0 && isBackgroundClick) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
        }
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],[data-node-id],[data-connection-id]")) return;
        onCanvasDoubleClick?.(event);
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (!panState.current.isPanning) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            schedulerRef.current?.move({
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: scaleRef.current,
            });
        };

        const handlePointerUp = () => {
            if (!panState.current.isPanning) return;

            if (!panState.current.hasMoved && panState.current.startedOnBackground) {
                callbacksRef.current.onCanvasDeselect?.();
            }
            schedulerRef.current?.flush();
            panState.current.isPanning = false;
            callbacksRef.current.onPanningChange?.(false);
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
            document.body.style.cursor = "";
        };
    }, []);

    useLayoutEffect(() => {
        // A React checkpoint must not overwrite a newer frame painted while
        // that checkpoint was rendering. Rebase selection overlays as well.
        const live = panState.current.isPanning || zoomingRef.current ? schedulerRef.current?.latest : null;
        if (live && layerRef.current) {
            layerRef.current.style.transform = `translate(${live.x}px, ${live.y}px) scale(${live.k})`;
            if (gridRef.current) gridRef.current.style.backgroundPosition = `${live.x % (48 * live.k)}px ${live.y % (48 * live.k)}px`;
            if (gridRef.current) gridRef.current.style.backgroundSize = `${48 * live.k}px ${48 * live.k}px`;
            layerRef.current.querySelectorAll<HTMLElement>("[data-node-panel]").forEach(panel => {
                panel.style.transform = `translateX(-50%) scale(${1 / live.k})`;
            });
        }
        liveViewportRef.current = live || viewport;
        scaleRef.current = (live || viewport).k;
        callbacksRef.current.onViewportPreview?.(live || viewport);
    }, [viewport]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Prevent canvas scrolling from moving the page while preserving native scrolling inside overlays and dialogs.
        const preventWheelScroll = (event: WheelEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;
            event.preventDefault();
        };
        container.addEventListener("wheel", preventWheelScroll, { passive: false });
        return () => container.removeEventListener("wheel", preventWheelScroll);
    }, [containerRef]);

    const temporaryTool = isControlPressed || isSpacePressed;
    const activeTool = temporaryTool ? (tool === "select" ? "pan" : "select") : tool;
    const cursor = isPanning ? "grabbing" : activeTool === "pan" ? "grab" : undefined;

    return (
        <div
            ref={containerRef}
            className="relative h-full w-full select-none overflow-hidden"
            style={{ background: theme.canvas.background, cursor }}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
            onContextMenu={onContextMenu}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
        >
            <CanvasGrid viewport={viewport} mode={backgroundMode} gridRef={gridRef} />
            <div
                ref={layerRef}
                className="absolute origin-top-left"
                style={{
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
                    willChange: isPanning ? "transform" : undefined,
                }}
            >
                {children}
            </div>
        </div>
    );
}

function CanvasGrid({ viewport, mode, gridRef }: { viewport: ViewportTransform; mode: CanvasBackgroundMode; gridRef: React.RefObject<HTMLDivElement | null> }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (mode === "blank") return null;

    const gridSize = 48 * viewport.k;
    const x = viewport.x % gridSize;
    const y = viewport.y % gridSize;
    const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
    const backgroundImage =
        mode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;

    return (
        <div
            ref={gridRef}
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
                backgroundImage,
                backgroundSize: `${gridSize}px ${gridSize}px`,
                backgroundPosition: `${x}px ${y}px`,
            }}
        />
    );
}
