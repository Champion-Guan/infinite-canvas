import { useCallback, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { Tabs, type TabsProps, type TabsRef } from "antd";
import { useReducedMotion } from "motion/react";
import { createTabFadePlayer } from "./页签淡变播放器";
import styles from "./页签内容过渡.module.css";
import { TAB_INDICATOR_BASE_STYLE, useUnifiedTabIndicator } from "./统一页签横条";

export function useNativeTabFade(element: RefObject<HTMLElement | null>, present: boolean, enterOnMount: boolean, enabled = true, onExited?: () => void) {
    const reduced = useReducedMotion();
    const player = useRef<ReturnType<typeof createTabFadePlayer> | null>(null);
    if (!player.current) player.current = createTabFadePlayer();
    const previous = useRef({ mounted: false, present, enabled });
    const finished = useRef(onExited);
    useLayoutEffect(() => { finished.current = onExited; });
    useLayoutEffect(() => {
        if (!element.current) return;
        const fromHidden = present && ((!previous.current.mounted && enterOnMount) || (!previous.current.present && !previous.current.enabled));
        previous.current = { mounted: true, present, enabled };
        player.current!.play(element.current, present, fromHidden, reduced === true || !enabled, () => { if (!present) finished.current?.(); });
    }, [element, present, enterOnMount, enabled, reduced]);
    useLayoutEffect(() => () => player.current!.stop(), []);
}

function TabSurface({ present, enter, enabled, children, onExited }: { present: boolean; enter: boolean; enabled: boolean; children: ReactNode; onExited?: () => void }) {
    const element = useRef<HTMLDivElement>(null);
    useNativeTabFade(element, present, enter, enabled, onExited);
    return <div ref={element} data-tab-fade-state={present ? "current" : "leaving"} inert={!present} aria-hidden={!present}
        className={`${styles.pane} ${present ? styles.current : styles.leaving}`}>{children}</div>;
}

type Snapshot = { key: string; children: ReactNode };
type Handoff = { key: string; previous: Snapshot | null; revision: number };

// 只保留当前内容和最近一次退场内容；连续切换不排队，也不积累隐藏页签。
export function TabContentTransition({ transitionKey, children, className, enabled = true, ...props }: { transitionKey: string; children: ReactNode; enabled?: boolean } & HTMLAttributes<HTMLDivElement>) {
    const committed = useRef<Snapshot>({ key: transitionKey, children });
    const [handoff, setHandoff] = useState<Handoff>({ key: transitionKey, previous: null, revision: 0 });
    if (handoff.key !== transitionKey) setHandoff({ key: transitionKey, previous: committed.current.key === handoff.key ? committed.current : null, revision: handoff.revision + 1 });
    useLayoutEffect(() => { committed.current = { key: transitionKey, children }; });
    const finish = useCallback((key: string, revision: number) => {
        setHandoff(current => current.previous?.key === key && current.revision === revision ? { ...current, previous: null } : current);
    }, []);
    useEffect(() => {
        if (!handoff.previous) return;
        const hide = () => { if (!enabled || document.visibilityState === "hidden") finish(handoff.previous!.key, handoff.revision); };
        hide();
        document.addEventListener("visibilitychange", hide);
        return () => document.removeEventListener("visibilitychange", hide);
    }, [enabled, handoff.previous, handoff.revision, finish]);
    return <div {...props} data-tab-transition={transitionKey} className={`${styles.root} ${className || ""}`}>
        <TabSurface key={transitionKey} present enter={handoff.revision > 0} enabled={enabled}>{children}</TabSurface>
        {handoff.previous && handoff.previous.key !== transitionKey ? <TabSurface key={handoff.previous.key} present={false} enter={false} enabled={enabled}
            onExited={() => finish(handoff.previous!.key, handoff.revision)}>{handoff.previous.children}</TabSurface> : null}
    </div>;
}

// 保留 Ant 的挂载缓存、表单、导航键盘与原生进退场，补齐退场阶段的 inert。
export function NativeFadeTabs({ activeKey, defaultActiveKey, items, onChange, animated, styles: customStyles, ...props }: TabsProps) {
    const reduced = useReducedMotion();
    const [internalKey, setInternalKey] = useState(defaultActiveKey);
    const requested = activeKey ?? internalKey;
    const current = items?.some(item => item.key === requested) ? requested : items?.[0]?.key;
    const root = useRef<TabsRef>(null);
    const horizontal = !["left", "right"].includes(props.tabPosition || "") && !["start", "end"].includes(props.tabPlacement || "");
    const line = horizontal && (!props.type || props.type === "line");
    useUnifiedTabIndicator(root, current || "", { native: true, enabled: line, reduced });
    const mergedStyles: TabsProps["styles"] = info => {
        const value = typeof customStyles === "function" ? customStyles(info) : customStyles;
        return line ? { ...value, indicator: { ...value?.indicator, ...TAB_INDICATOR_BASE_STYLE } } : value || {};
    };
    return <Tabs {...props} ref={root} styles={mergedStyles} activeKey={activeKey} defaultActiveKey={defaultActiveKey}
        animated={{ inkBar: !line && !reduced && (typeof animated === "object" ? animated.inkBar !== false : animated !== false), tabPane: !reduced }}
        onChange={key => { setInternalKey(key); onChange?.(key); }}
        items={items?.map(item => ({ ...item, style: { ...item.style, pointerEvents: item.key === current ? item.style?.pointerEvents : "none" },
            children: item.children == null ? item.children : <div inert={item.key !== current} style={{ display: "contents" }}>{item.children}</div> }))} />;
}
