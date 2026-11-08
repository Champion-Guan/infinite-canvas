import { useEffect } from "react";

export const APPLE_PANEL_SPRING = { type: "spring" as const, stiffness: 440, damping: 42, mass: .9 };
export const panelTransition = (direct: boolean, reduced: boolean | null) => direct || reduced ? { duration: 0 } : APPLE_PANEL_SPRING;

// 隐藏页没有可见退场；只由活动产品结束本次关闭，不让缓存产品提前卸载活动侧栏。
export function useHiddenPanelExit(active: boolean, closing: boolean, revision: number, finish: (revision: number) => void) {
    useEffect(() => {
        if (!active || !closing) return;
        const sync = () => { if (document.visibilityState === "hidden") finish(revision); };
        sync();
        document.addEventListener("visibilitychange", sync);
        return () => document.removeEventListener("visibilitychange", sync);
    }, [active, closing, revision, finish]);
}
