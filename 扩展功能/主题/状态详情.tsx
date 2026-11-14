import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert, Info, X } from "lucide-react";
import { OutsidePopover } from "./原生可关闭浮层";
import styles from "./状态详情.module.css";

export function StatusDetails({ label, title = label, failed = false, children, className = "" }: {
    label: string; title?: string; failed?: boolean; children: ReactNode; className?: string;
}) {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!open) return;
        const close = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation(); setOpen(false);
        };
        window.addEventListener("keydown", close, true);
        return () => window.removeEventListener("keydown", close, true);
    }, [open]);
    return <OutsidePopover open={open} onOpenChange={setOpen} trigger="click" placement="bottomLeft"
        content={<section role="dialog" aria-label={title} data-canvas-no-zoom
            className="w-72 max-w-[calc(100vw-48px)] space-y-3 text-left text-xs leading-5"
            onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
            onDoubleClick={event => event.stopPropagation()} onKeyDown={event => {
                event.stopPropagation(); if (event.key === "Escape") setOpen(false);
            }}>
            <div className="flex items-center justify-between gap-3">
                <strong className={`inline-flex items-center gap-1.5 font-semibold ${failed ? styles.error : ""}`}>
                    {failed ? <CircleAlert aria-hidden className="size-3.5 shrink-0" /> : null}{title}
                </strong>
                <button type="button" aria-label={`关闭${title}`} title="关闭" className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-current/10"
                    onClick={() => setOpen(false)}><X aria-hidden size={14} /></button>
            </div>
            <div className={`space-y-3 break-words whitespace-normal ${failed ? styles.message : ""}`}>{children}</div>
        </section>}>
        <button type="button" aria-label={`查看${title.endsWith("详情") ? title : `${title}详情`}`} aria-expanded={open} aria-haspopup="dialog"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded text-xs hover:opacity-75 ${failed ? styles.error : ""} ${className}`}
            onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
            onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}
            onDoubleClick={event => event.stopPropagation()}>
            {failed ? <CircleAlert aria-hidden className="size-3.5 shrink-0" /> : <Info aria-hidden className="size-3.5 shrink-0" />}
            <span>{label}</span>
        </button>
    </OutsidePopover>;
}
