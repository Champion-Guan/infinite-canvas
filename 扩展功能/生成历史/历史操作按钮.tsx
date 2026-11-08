import { useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { APPLE_CONTROL_SPRING } from "../主题/苹果动效";
import { Tooltip } from "antd";
import { cn } from "@/lib/utils";
import styles from "./历史操作栏.module.css";

type Props = Omit<HTMLMotionProps<"button">, "children" | "title"> & {
    label: string;
    description: string;
    icon: ReactNode;
};

// 文字由侧栏容器宽度控制；禁用时仍可通过外层触发说明。
export function HistoryActionButton({ label, description, icon, className, ...props }: Props) {
    const reducedMotion = useReducedMotion();
    const [tooltipOpen, setTooltipOpen] = useState(false);
    const hovered = useRef(false);
    const keyboardFocused = useRef(false);
    const dismissedFocus = useRef(false);
    return <Tooltip title={description} placement="top" open={tooltipOpen}
        onOpenChange={next => setTooltipOpen(next && (hovered.current || keyboardFocused.current))}
        styles={{ root: { maxWidth: "min(320px, calc(100vw - 24px))" } }}
        trigger={["hover", "focus"]} mouseEnterDelay={0.25}>
        <span className={styles.trigger}
            onMouseEnter={() => { hovered.current = true; dismissedFocus.current = false; }}
            onMouseLeave={() => { hovered.current = false; }}
            onFocusCapture={event => {
                keyboardFocused.current = !dismissedFocus.current && event.target.matches(":focus-visible");
                dismissedFocus.current = false;
            }}
            onBlurCapture={event => {
                keyboardFocused.current = false;
                setTooltipOpen(false);
                if (event.relatedTarget && !event.relatedTarget.closest('[role="dialog"]')) dismissedFocus.current = false;
            }}
            onKeyDownCapture={event => { if (event.key === "Tab") dismissedFocus.current = false; }}
            onClickCapture={() => {
                // 执行后收起说明；弹窗归还焦点不代表用户再次请求说明。
                hovered.current = false;
                keyboardFocused.current = false;
                dismissedFocus.current = true;
                setTooltipOpen(false);
            }}>
            <motion.button {...props} type="button" aria-label={label}
                whileTap={props.disabled || reducedMotion ? undefined : { scale: .96 }} transition={APPLE_CONTROL_SPRING}
                className={cn("guan-apple-action inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40", styles.button, className)}>
                <span aria-hidden="true">{icon}</span>
                <span className={styles.label}>{label}</span>
            </motion.button>
        </span>
    </Tooltip>;
}
