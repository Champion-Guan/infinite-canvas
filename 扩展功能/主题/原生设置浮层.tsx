import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { OutsidePanelScope, useOutsidePanel } from "./原生可关闭浮层";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { createProductPortal, useProductActive } from "../产品/产品界面边界";
import { positionSettingsPanel } from "../画布交互/设置浮层稳定定位";
import { APPLE_POPOVER_TRANSITION } from "./苹果动效";

function SettingsPanel({ label, theme, trigger, placement, close, children }: {
  label: string; theme: CanvasTheme; trigger: RefObject<HTMLSpanElement | null>; placement: string;
  close(): void; children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const present = useIsPresent(), reduced = useReducedMotion();
  const { layer } = useOutsidePanel(present, () => trigger.current, () => panel.current, close);
  useLayoutEffect(() => {
    if (!panel.current || !content.current || !trigger.current) return;
    return positionSettingsPanel(panel.current, content.current, trigger.current, placement);
  }, [trigger, placement]);
  return <OutsidePanelScope layer={layer}><motion.div ref={panel}
    data-canvas-settings-popover data-canvas-shortcuts-ignore role="dialog" aria-label={label}
    aria-hidden={!present} inert={!present}
    initial={{ opacity: 0, scale: reduced ? 1 : .98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : .98 }}
    transition={reduced ? { duration: 0 } : APPLE_POPOVER_TRANSITION}
    style={{ position: "fixed", visibility: "hidden", width: 356, zIndex: 1200, overflowY: "auto", overscrollBehavior: "contain",
      pointerEvents: present ? "auto" : "none", borderRadius: 18, background: theme.toolbar.panel, color: theme.node.text,
      boxShadow: "0 18px 54px rgba(28,25,23,.16)" }}
    onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
      if ((event.target as HTMLElement).closest('.ant-select-open,.ant-select-dropdown,.ant-picker-dropdown')) return;
      event.preventDefault(); event.stopPropagation(); close();
      trigger.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }}><div ref={content} style={{ padding: 18 }}>{children}</div></motion.div></OutsidePanelScope>;
}

export function NativeSettingsPopover({ label, placement = "topLeft", theme, onOpenChange, children, content }: {
  label: string;
  placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
  theme: CanvasTheme;
  onOpenChange?(open: boolean): void;
  children: ReactElement<{ "aria-expanded"?: boolean }>;
  content: ReactNode;
}) {
  const active = useProductActive(), [open, setOpen] = useState(false);
  const trigger = useRef<HTMLSpanElement>(null);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  useEffect(() => {
    if (!active && open) { setOpen(false); onOpenChange?.(false); }
  }, [active, open, onOpenChange]);
  return <>
    <span ref={trigger} className="inline-flex min-w-0" onClick={() => {
      if (!trigger.current?.querySelector('button:disabled,[aria-disabled="true"]')) change(!open);
    }}>{cloneElement(children, { "aria-expanded": active && open })}</span>
    {typeof document !== "undefined" && createProductPortal(<AnimatePresence>{active && open &&
      <SettingsPanel label={label} theme={theme} trigger={trigger} placement={placement} close={() => change(false)}>{content}</SettingsPanel>
    }</AnimatePresence>, document.body)}
  </>;
}
