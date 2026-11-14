import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { Modal, type ModalProps } from "antd";
import { usePresence } from "motion/react";
import { OutsidePanelScope, useOutsidePanel } from "./原生可关闭浮层";
import styles from "./苹果弹窗布局.module.css";

const ModalDepth = createContext(0);

function ModalSurface({ panel, visible, opener, triggerId, children }: {
    panel: RefObject<HTMLDivElement | null>; visible: boolean; opener: RefObject<HTMLElement | null>; triggerId?: string; children: ReactNode;
}) {
    useLayoutEffect(() => {
        if (!visible) return;
        const modal = panel.current?.closest<HTMLElement>(".ant-modal");
        const anchor = (triggerId ? document.getElementById(triggerId) : null) ?? opener.current;
        if (!modal || !anchor) return;
        const target = anchor.getBoundingClientRect();
        const sync = () => {
            if (!modal.offsetWidth) return;
            const parent = modal.offsetParent?.getBoundingClientRect();
            // 原生准备阶段的scale会改变视觉矩形，动画起点使用最终布局坐标。
            modal.style.setProperty("--apple-modal-origin", `${target.left + target.width / 2 - (parent?.left ?? 0) - modal.offsetLeft}px ${target.top + target.height / 2 - (parent?.top ?? 0) - modal.offsetTop}px`);
        };
        const observer = new ResizeObserver(sync);
        observer.observe(modal); sync();
        return () => observer.disconnect();
    }, [visible, opener, panel, triggerId]);
    return <div ref={panel} data-apple-modal-state={visible ? "open" : "closing"} inert={!visible}>{children}</div>;
}

// 沿用快捷键面板的原生遮罩和窗口过渡；Presence只负责保留退出内容。
export function AppleModal({ open = true, maskClosable = true, modalRender, afterClose, transitionName, maskTransitionName, triggerId, ...props }: ModalProps & { triggerId?: string }) {
    const [present, safeToRemove] = usePresence();
    const visible = Boolean(open && present);
    const depth = useContext(ModalDepth);
    const panel = useRef<HTMLDivElement>(null);
    const opener = useRef<HTMLElement | null>(null);
    const wasVisible = useRef(false);
    if (visible && !wasVisible.current && typeof document !== "undefined") {
        const focused = document.activeElement;
        opener.current = (triggerId ? document.getElementById(triggerId) : null)
            ?? (focused instanceof HTMLElement ? focused.closest<HTMLElement>('button,[role="button"],a') : null);
    }
    wasVisible.current = visible;
    const { layer } = useOutsidePanel(visible && maskClosable !== false && Boolean(props.onCancel), () => triggerId ? document.getElementById(triggerId) : null,
        () => panel.current?.closest<HTMLElement>(".ant-modal") ?? panel.current,
        event => props.onCancel?.(event as unknown as Parameters<NonNullable<ModalProps["onCancel"]>>[0]), true);
    const lifecycle = useRef({ visible, present, revision: 0 });
    lifecycle.current = { visible, present, revision: lifecycle.current.revision + Number(lifecycle.current.visible !== visible) };
    const revision = lifecycle.current.revision;
    const origin = useRef<{ x: number; y: number } | undefined>(undefined);
    const snapshot = useRef<Pick<ModalProps, "children" | "title" | "footer" | "modalRender"> | null>(null);
    if (visible && triggerId && (!snapshot.current || !lifecycle.current.present)) {
        const rect = document.getElementById(triggerId)?.getBoundingClientRect();
        origin.current = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
    }
    if (visible) snapshot.current = { children: props.children, title: props.title, footer: props.footer, modalRender };
    const content = snapshot.current;
    useEffect(() => {
        if (!present && !snapshot.current) safeToRemove?.();
    }, [present, safeToRemove]);
    return <OutsidePanelScope layer={layer}><ModalDepth.Provider value={depth + 1}><Modal {...props}
        zIndex={props.zIndex ?? 1600 + depth * 100}
        className={[styles.window, (triggerId || opener.current) && styles.anchored, props.className].filter(Boolean).join(" ")}
        wrapClassName={[styles.wrapper, props.wrapClassName].filter(Boolean).join(" ")}
        mousePosition={props.mousePosition ?? origin.current}
        title={content?.title ?? props.title} footer={content ? content.footer : props.footer} open={visible} maskClosable={maskClosable}
        transitionName={transitionName || undefined} maskTransitionName={maskTransitionName || undefined}
        afterClose={() => {
            if (lifecycle.current.visible || lifecycle.current.revision !== revision) return;
            snapshot.current = null;
            afterClose?.();
            if (!lifecycle.current.present) safeToRemove?.();
        }}
        modalRender={node => <ModalSurface panel={panel} visible={visible} opener={opener} triggerId={triggerId}>
            {content?.modalRender ? content.modalRender(node) : node}
        </ModalSurface>}>{content ? content.children : props.children}</Modal></ModalDepth.Provider></OutsidePanelScope>;
}
