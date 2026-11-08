import type { ReactNode } from "react";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import { APPLE_SURFACE_SPRING } from "./苹果动效";

export function SelectionInline({ children, width = 16, gap = 8 }: { children: ReactNode; width?: number; gap?: number }) {
    const present = useIsPresent();
    const reduced = useReducedMotion();
    return <motion.span data-selection-transition="inline" inert={!present} aria-hidden={!present}
        className="inline-flex shrink-0 items-center overflow-hidden"
        initial={{ width: 0, opacity: 0, marginRight: -gap }}
        animate={{ width, opacity: 1, marginRight: 0 }} exit={{ width: 0, opacity: 0, marginRight: -gap }}
        transition={reduced ? { duration: 0 } : APPLE_SURFACE_SPRING}>{children}</motion.span>;
}

export function SelectionFooter({ children }: { children: ReactNode }) {
    const present = useIsPresent();
    const reduced = useReducedMotion();
    return <motion.div data-selection-transition="footer" inert={!present} aria-hidden={!present}
        className="shrink-0 overflow-hidden" initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
        transition={reduced ? { duration: 0 } : APPLE_SURFACE_SPRING}>{children}</motion.div>;
}
