import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

type Position = { left: number; top: number };
type Item = { element: HTMLElement; key: string; position: Position };

function visibleItems(root: HTMLElement): Item[] {
    const clips = new Map<Element, DOMRect>();
    return [...root.querySelectorAll<HTMLElement>("[data-history-sort-key]")].flatMap(element => {
        const list = element.closest("[data-history-virtual-list]");
        if (!list) return [];
        let clip = clips.get(list);
        if (!clip) { clip = list.getBoundingClientRect(); clips.set(list, clip); }
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.bottom <= clip.top || rect.top >= clip.bottom || rect.right <= clip.left || rect.left >= clip.right) return [];
        return [{ element, key: `${list.getAttribute("data-history-virtual-list")}:${element.dataset.historySortKey}`,
            position: { left: rect.left, top: rect.top } }];
    });
}

// 排序前读取当前呈现位置，排序后只播放可见项；不改变虚拟列表用于定位的transform。
export function createHistorySortMotion() {
    let previous: Map<string, Position> | null = null;
    const running = new Map<HTMLElement, Animation>();
    const stop = () => {
        previous = null;
        for (const animation of running.values()) animation.cancel();
        running.clear();
    };
    return {
        capture(root: HTMLElement) {
            const positions = new Map(visibleItems(root).map(item => [item.key, item.position]));
            stop(); previous = positions;
        },
        play(root: HTMLElement, reduced: boolean) {
            const positions = previous;
            previous = null;
            if (reduced) { stop(); return; }
            if (!positions) return;
            const items = visibleItems(root);
            for (const { element, key, position } of items) {
                const old = positions.get(key);
                const x = old ? old.left - position.left : 0, y = old ? old.top - position.top : 6;
                if (old && Math.abs(x) < .5 && Math.abs(y) < .5) continue;
                try {
                    const animation = element.animate([
                        { translate: `${x}px ${y}px`, opacity: old ? 1 : 0 },
                        { translate: "0px 0px", opacity: 1 },
                    ], { duration: 220, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" });
                    running.set(element, animation);
                    const finish = () => {
                        if (running.get(element) !== animation) return;
                        running.delete(element); animation.cancel();
                    };
                    void animation.finished.then(finish, finish);
                } catch { /* 原生动画不可用时，排序结果仍即时呈现。 */ }
            }
        },
        stop,
    };
}

export function useHistorySortMotion(sorted: boolean) {
    const root = useRef<HTMLDivElement>(null);
    const reduced = useReducedMotion();
    const motion = useRef<ReturnType<typeof createHistorySortMotion> | null>(null);
    if (!motion.current) motion.current = createHistorySortMotion();
    const capture = useCallback(() => { if (root.current && !reduced) motion.current!.capture(root.current); }, [reduced]);
    useLayoutEffect(() => { if (root.current) motion.current!.play(root.current, reduced === true); }, [sorted, reduced]);
    useEffect(() => () => motion.current!.stop(), []);
    return { root, capture };
}
