import { useEffect, useRef } from "react";
import { Modal, type ModalProps } from "antd";
import { usePresence } from "motion/react";
import { OutsidePanelScope, useOutsidePanel } from "./原生可关闭浮层";

// 沿用快捷键面板的原生遮罩和窗口过渡；Presence只负责保留退出内容。
export function AppleModal({ open = true, maskClosable = true, modalRender, afterClose, transitionName, maskTransitionName, triggerId, ...props }: ModalProps & { triggerId?: string }) {
    const [present, safeToRemove] = usePresence();
    const visible = Boolean(open && present);
    const panel = useRef<HTMLDivElement>(null);
    const { layer } = useOutsidePanel(visible && maskClosable !== false && Boolean(props.onCancel), () => triggerId ? document.getElementById(triggerId) : null,
        () => panel.current?.closest<HTMLElement>(".ant-modal") ?? panel.current,
        event => props.onCancel?.(event as unknown as Parameters<NonNullable<ModalProps["onCancel"]>>[0]), true);
    const lifecycle = useRef({ visible, present, revision: 0 });
    lifecycle.current = { visible, present, revision: lifecycle.current.revision + Number(lifecycle.current.visible !== visible) };
    const revision = lifecycle.current.revision;
    const snapshot = useRef<Pick<ModalProps, "children" | "title" | "footer" | "modalRender"> | null>(null);
    if (visible) snapshot.current = { children: props.children, title: props.title, footer: props.footer, modalRender };
    const content = snapshot.current;
    useEffect(() => {
        if (!present && !snapshot.current) safeToRemove?.();
    }, [present, safeToRemove]);
    return <OutsidePanelScope layer={layer}><Modal {...props} title={content?.title ?? props.title} footer={content ? content.footer : props.footer} open={visible} maskClosable={maskClosable}
        transitionName={transitionName || undefined} maskTransitionName={maskTransitionName || undefined}
        afterClose={() => {
            if (lifecycle.current.visible || lifecycle.current.revision !== revision) return;
            snapshot.current = null;
            afterClose?.();
            if (!lifecycle.current.present) safeToRemove?.();
        }}
        modalRender={node => <div ref={panel} data-apple-modal-state={visible ? "open" : "closing"} inert={!visible}>
            {content?.modalRender ? content.modalRender(node) : node}
        </div>}>{content ? content.children : props.children}</Modal></OutsidePanelScope>;
}
