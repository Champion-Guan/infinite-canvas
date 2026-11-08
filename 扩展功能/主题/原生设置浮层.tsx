import { cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { OutsidePopover as Popover } from "@/扩展功能/主题/原生可关闭浮层";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { useProductActive } from "../产品/产品界面边界";

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
  return <Popover trigger="click" open={active && open} onOpenChange={change} placement={placement} arrow={false}
    autoAdjustOverflow fresh
    classNames={{ root: "canvas-image-settings-popover" }}
    styles={{ root: { width: "min(356px, calc(100vw - 24px))", zIndex: 1200 },
      container: { background: theme.toolbar.panel, color: theme.node.text, borderRadius: 18, padding: 18,
        maxHeight: "calc(100dvh - 96px)", overflowY: "auto" } }}
    content={<div data-canvas-settings-popover data-canvas-shortcuts-ignore role="dialog" aria-label={label}
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
        if ((event.target as HTMLElement).closest('.ant-select-open,.ant-select-dropdown,.ant-picker-dropdown')) return;
        event.preventDefault(); event.stopPropagation(); change(false);
        trigger.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }}>{content}</div>}>
    <span ref={trigger} className="inline-flex min-w-0">{cloneElement(children, { "aria-expanded": active && open })}</span>
  </Popover>;
}
