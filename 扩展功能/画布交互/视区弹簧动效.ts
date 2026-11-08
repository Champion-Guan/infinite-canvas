import { useCallback, useEffect, useRef, type RefObject } from "react";
import { spring } from "motion";
import { useReducedMotion } from "motion/react";
import type { ViewportTransform } from "@/types/canvas";
import type { CanvasViewportController } from "@/components/canvas/infinite-canvas";
import { APPLE_CONTROL_SPRING } from "../主题/苹果动效";
import { usePageVisible } from "../主题/可见页面轮询";

type FrameRef = { current: number | null };
type MotionPort = {
    frameRef: FrameRef;
    read(): ViewportTransform;
    begin(viewport: ViewportTransform): void;
    move(viewport: ViewportTransform): void;
    finish(): void;
    frame(callback: (now: number) => void): number;
    cancel(id: number): void;
    now(): number;
};
const axes = ["x", "y", "k"] as const;
const zeroVelocity = () => ({ x: 0, y: 0, k: 0 });

// 复用 Motion 的物理弹簧；X/Y/缩放各自携带速度，取消只停在当前位置。
export function createViewportSpring(port: MotionPort) {
    let running = false, generation = 0;
    let velocity = zeroVelocity();
    const cancelFrame = () => {
        if (port.frameRef.current !== null) port.cancel(port.frameRef.current);
        port.frameRef.current = null;
    };
    const stop = () => {
        generation++;
        cancelFrame();
        if (running) { running = false; port.finish(); }
        velocity = zeroVelocity();
    };
    const moveTo = (target: ViewportTransform, reducedMotion = false) => {
        if (!axes.every(axis => Number.isFinite(target[axis])) || target.k < .05 || target.k > 5)
            throw new Error("目标视区无效。");
        const token = ++generation;
        cancelFrame();
        if (running) port.finish();
        const start = { ...port.read() };
        if (axes.every(axis => start[axis] === target[axis]) && axes.every(axis => Math.abs(velocity[axis]) < .001)) {
            running = false; velocity = zeroVelocity(); return;
        }
        port.begin(start);
        if (reducedMotion) {
            running = false; velocity = zeroVelocity();
            port.move(target); port.finish(); return;
        }
        running = true;
        const generators = axes.map(axis => spring({
            ...APPLE_CONTROL_SPRING, keyframes: [start[axis], target[axis]], velocity: velocity[axis],
            restDelta: axis === "k" ? .0001 : .1, restSpeed: axis === "k" ? .001 : 1,
        }));
        let previous = start, previousAt = 0;
        const startedAt = port.now();
        const step = (now: number) => {
            if (token !== generation) return;
            const elapsed = Math.max(0, now - startedAt);
            const next = { ...target };
            let done = true;
            axes.forEach((axis, index) => {
                const sample = generators[index].next(elapsed);
                next[axis] = axis === "k" ? Math.min(5, Math.max(.05, sample.value)) : sample.value;
                done = done && sample.done;
                if (elapsed > previousAt) velocity[axis] = (next[axis] - previous[axis]) * 1000 / (elapsed - previousAt);
            });
            previous = next; previousAt = elapsed;
            port.move(done ? target : next);
            if (done) {
                port.frameRef.current = null; running = false; velocity = zeroVelocity();
                port.finish();
            } else port.frameRef.current = port.frame(step);
        };
        port.frameRef.current = port.frame(step);
    };
    return { moveTo, stop };
}

export function useViewportSpring({ active, viewportRef, focusAnimRef, viewportControllerRef, setViewport }: {
    active: boolean;
    viewportRef: RefObject<ViewportTransform>;
    focusAnimRef: RefObject<number | null>;
    viewportControllerRef: RefObject<CanvasViewportController | null>;
    setViewport(viewport: ViewportTransform): void;
}) {
    const reducedMotion = useReducedMotion(), pageVisible = usePageVisible();
    const latest = useRef({ viewportRef, focusAnimRef, viewportControllerRef, setViewport });
    latest.current = { viewportRef, focusAnimRef, viewportControllerRef, setViewport };
    const motion = useRef<ReturnType<typeof createViewportSpring> | null>(null);
    if (!motion.current) motion.current = createViewportSpring({
        frameRef: focusAnimRef,
        read: () => latest.current.viewportRef.current,
        begin: start => latest.current.viewportControllerRef.current?.begin(start),
        move: next => {
            const controller = latest.current.viewportControllerRef.current;
            if (controller) controller.move(next);
            else { latest.current.viewportRef.current = next; latest.current.setViewport(next); }
        },
        finish: () => latest.current.viewportControllerRef.current?.finish(),
        frame: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id), now: () => performance.now(),
    });
    const moveTo = useCallback((target: ViewportTransform) => {
        if (active && pageVisible) motion.current!.moveTo(target, reducedMotion === true);
    }, [active, pageVisible, reducedMotion]);
    const stop = useCallback(() => motion.current!.stop(), []);
    useEffect(() => {
        if (!active || !pageVisible || reducedMotion) stop();
        return stop;
    }, [active, pageVisible, reducedMotion, stop]);
    return { moveTo, stop };
}
