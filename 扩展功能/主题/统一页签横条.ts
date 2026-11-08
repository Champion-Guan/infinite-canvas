import { useEffect, useLayoutEffect, useRef, type CSSProperties, type RefObject } from "react";
import { createCapsuleSlideMotion } from "../产品/胶囊滑动动效";

export const TAB_INDICATOR_BASE_STYLE: CSSProperties = {
    position: "absolute", left: 0, right: "auto", width: 0, height: 2,
    transform: "none", transformOrigin: "left center", transition: "none", pointerEvents: "none",
};

type Root = HTMLElement | { nativeElement: HTMLElement | null };
type Frame = { x: number; width: number };

// offset 属于布局坐标，不受窗口缩放、按压缩放或祖先平移影响。
export function tabIndicatorFrame(track: HTMLElement, tab: HTMLElement): Frame | null {
    if (!track.contains(tab) || !track.offsetWidth || !tab.offsetWidth) return null;
    const offset = (element: HTMLElement) => {
        let x = 0;
        for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) x += node.offsetLeft;
        return x;
    };
    return { x: offset(tab) - offset(track), width: tab.offsetWidth };
}

export function useUnifiedTabIndicator(root: RefObject<Root | null>, activeKey: string, { native = false, enabled = true, reduced = false }: { native?: boolean; enabled?: boolean; reduced?: boolean | null } = {}) {
    const indicator = useRef<HTMLElement | null>(null);
    const initialized = useRef(false);
    const previous = useRef<Frame | null>(null);
    const player = useRef<ReturnType<typeof createCapsuleSlideMotion> | null>(null);
    if (!player.current) player.current = createCapsuleSlideMotion({
        read: () => {
            const element = indicator.current!;
            const style = getComputedStyle(element);
            const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
            return { x: matrix.m41, width: (Number.parseFloat(style.width) || element.offsetWidth) * matrix.a };
        },
        move: frame => {
            if (!indicator.current) return;
            indicator.current.style.width = `${frame.width}px`;
            indicator.current.style.transform = `translateX(${frame.x}px)`;
        },
        play: (frames, duration) => {
            const element = indicator.current!, base = frames.at(-1)!.width;
            element.style.width = `${base}px`;
            const animation = element.animate(frames.map(frame => ({ transform: `translateX(${frame.x}px) scaleX(${frame.width / base})` })),
                { duration, easing: "linear", fill: "both" });
            return { time: () => Number(animation.currentTime ?? 0), finished: animation.finished, cancel: () => animation.cancel() };
        },
    });
    useEffect(() => () => player.current!.stop(), []);
    useLayoutEffect(() => {
        const value = root.current, host = value && "nativeElement" in value ? value.nativeElement : value;
        if (!enabled || !host) { player.current!.stop(); initialized.current = false; return; }
        const track = native ? host.querySelector<HTMLElement>(".ant-tabs-nav-list") : host;
        if (!track) return;
        let disposed = false;
        const measure = (resize = false) => {
            if (disposed) return;
            const element = track.querySelector<HTMLElement>(native ? ".ant-tabs-ink-bar" : "[data-unified-tab-indicator]");
            const tab = track.querySelector<HTMLElement>(native ? ".ant-tabs-tab-active" : '[data-tab-indicator-active="true"]');
            const frame = tab && tabIndicatorFrame(track, tab);
            const replaced = indicator.current !== element;
            indicator.current = element;
            if (!element || !frame) {
                player.current!.stop(); initialized.current = false; previous.current = null;
                if (element) element.style.width = "0px";
                return;
            }
            if (resize && !replaced && previous.current?.x === frame.x && previous.current?.width === frame.width) return;
            try { player.current!.moveTo(frame, !initialized.current || replaced || Boolean(reduced) || resize); }
            catch { player.current!.stop(); element.style.width = `${frame.width}px`; element.style.transform = `translateX(${frame.x}px)`; }
            previous.current = frame; initialized.current = true;
        };
        measure();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure(true));
        observer?.observe(track);
        track.querySelectorAll<HTMLElement>(native ? ".ant-tabs-tab" : "[data-tab-indicator-active]").forEach(tab => observer?.observe(tab));
        const labels = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => measure(true));
        labels?.observe(track, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "aria-selected"] });
        const resize = () => measure(true);
        const visibility = () => { if (document.visibilityState === "hidden") player.current!.finish(); else measure(true); };
        window.addEventListener("resize", resize);
        document.addEventListener("visibilitychange", visibility);
        void document.fonts?.ready.then(() => measure(true));
        return () => { disposed = true; observer?.disconnect(); labels?.disconnect(); window.removeEventListener("resize", resize); document.removeEventListener("visibilitychange", visibility); };
    }, [root, activeKey, native, enabled, reduced]);
}
