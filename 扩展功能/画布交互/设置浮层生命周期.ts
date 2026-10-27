import { useCallback, useEffect, useRef, useState } from "react";
import { useProductActive } from "../产品/产品界面边界";

export function useSettingsPopover(onOpenChange?: (open: boolean) => void) {
    const active = useProductActive();
    const buttonRef = useRef<HTMLSpanElement>(null), panelRef = useRef<HTMLDivElement>(null);
    const callback = useRef(onOpenChange);
    useEffect(() => { callback.current = onOpenChange; }, [onOpenChange]);
    const [open, setOpen] = useState(false);
    const openRef = useRef(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const updateOpen = useCallback((next: boolean) => {
        if (openRef.current === next) return;
        openRef.current = next;
        if (next) setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        setOpen(next);
        callback.current?.(next);
    }, []);
    useEffect(() => {
        if (!open || !active) return;
        const sync = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const outside = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node) || buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            // Ant Design的选项在同一产品的Portal中，不能在pointerdown阶段卸载它。
            if (target instanceof Element && target.closest('.ant-select-dropdown,.ant-popover,.ant-picker-dropdown')) return;
            updateOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest('.ant-select-open,.ant-select-dropdown,.ant-picker-dropdown')) return;
            if (target?.closest('[role="dialog"]') && !panelRef.current?.contains(target)) return;
            event.preventDefault(); event.stopPropagation(); updateOpen(false);
            buttonRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        };
        sync();
        window.addEventListener("resize", sync);
        window.addEventListener("scroll", sync, true);
        window.addEventListener("pointerdown", outside, true);
        window.addEventListener("keydown", escape);
        return () => {
            window.removeEventListener("resize", sync);
            window.removeEventListener("scroll", sync, true);
            window.removeEventListener("pointerdown", outside, true);
            window.removeEventListener("keydown", escape);
        };
    }, [active, open, updateOpen]);
    return { buttonRef, panelRef, open, buttonRect, updateOpen };
}
