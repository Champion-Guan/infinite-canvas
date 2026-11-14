import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createProductPortal, useProductActive } from "../产品/产品界面边界";
import { positionReferencePreview } from "../画布交互/图片引用预览定位";
import { APPLE_POPOVER_TRANSITION } from "../主题/苹果动效";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

function PreviewSurface({ anchor, children }: { anchor: RefObject<HTMLSpanElement | null>; children: ReactNode }) {
    const panel = useRef<HTMLDivElement>(null), reduced = useReducedMotion();
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    useLayoutEffect(() => {
        const button = anchor.current?.querySelector("button");
        if (panel.current && button) return positionReferencePreview(panel.current, button);
    }, [anchor]);
    return <motion.div ref={panel} data-image-reference-popup role="tooltip"
        initial={{ opacity: 0, scale: reduced ? 1 : .98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : .98 }}
        transition={reduced ? { duration: 0 } : APPLE_POPOVER_TRANSITION}
        style={{ position: "fixed", visibility: "hidden", pointerEvents: "none", zIndex: 1400, padding: 12, boxSizing: "border-box",
            borderRadius: 8, background: theme.toolbar.panel, color: theme.node.text, boxShadow: "0 8px 28px rgba(15,23,42,.16)",
            "--reference-preview-background": theme.toolbar.panel } as CSSProperties}>
        <span data-reference-preview-arrow aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, border: "6px solid transparent", pointerEvents: "none" }} />
        {children}
    </motion.div>;
}

export function ImageReferenceHoverPreview({ children, content }: { children: ReactNode; content: ReactNode }) {
    const anchor = useRef<HTMLSpanElement>(null), active = useProductActive();
    const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [dismissed, setDismissed] = useState(false);
    useEffect(() => { if (!active) { setHovered(false); setFocused(false); setDismissed(false); } }, [active]);
    return <span ref={anchor} style={{ display: "contents" }}
        onMouseEnter={() => { setHovered(true); setDismissed(false); }} onMouseLeave={() => { setHovered(false); setDismissed(false); }}
        onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={() => { setFocused(false); setDismissed(false); }}
        onClickCapture={() => setDismissed(true)}
        onKeyDown={event => { if (event.key === "Escape") { setDismissed(true); event.stopPropagation(); } }}>
        {children}
        {typeof document !== "undefined" && createProductPortal(<AnimatePresence>{active && !dismissed && (hovered || focused) &&
            <PreviewSurface anchor={anchor}>{content}</PreviewSurface>}</AnimatePresence>, document.body)}
    </span>;
}
