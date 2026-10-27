import type { TabsProps } from "antd";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Tabs 缓存初次测量。祖先的缩放动画不会触发 ResizeObserver，
// 因此在入场结束后只重新挂载导航条，保留设置内容、表单和面板动画。
export function useSettingsTabBarAlignment() {
    const surfaceRef = useRef<HTMLDivElement>(null);
    const focusedTabId = useRef<string | null>(null);
    const [measurement, setMeasurement] = useState(0);

    useEffect(() => {
        const surface = surfaceRef.current;
        if (!surface) return;
        const ancestors: HTMLElement[] = [];
        const remeasure = (event: AnimationEvent) => {
            if (event.target !== event.currentTarget) return;
            focusedTabId.current = surface.querySelector<HTMLElement>('[role="tab"]:focus')?.id ?? null;
            setMeasurement((value) => value + 1);
        };
        // Modal 的缩放可能在子组件 effect 之后才启动，不能只等待挂载瞬间
        // getAnimations() 的快照；分别接收各祖先真实的动画结束事件。
        for (let element: HTMLElement | null = surface; element; element = element.parentElement) {
            ancestors.push(element);
            element.addEventListener("animationend", remeasure);
            element.addEventListener("animationcancel", remeasure);
        }
        return () => {
            for (const element of ancestors) {
                element.removeEventListener("animationend", remeasure);
                element.removeEventListener("animationcancel", remeasure);
            }
        };
    }, []);

    useLayoutEffect(() => {
        const id = focusedTabId.current;
        focusedTabId.current = null;
        if (!id || document.activeElement !== document.body) return;
        const tab = document.getElementById(id);
        if (tab && surfaceRef.current?.contains(tab)) tab.focus({ preventScroll: true });
    }, [measurement]);

    const renderTabBar = useCallback<NonNullable<TabsProps["renderTabBar"]>>(
        (props, TabBar) => <TabBar {...props} key={measurement} />,
        [measurement],
    );
    return { surfaceRef, renderTabBar };
}
