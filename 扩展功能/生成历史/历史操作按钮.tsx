import type { ReactNode } from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
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
    return <Tooltip title={description} trigger={["hover", "focus"]} mouseEnterDelay={0.25}>
        <span className={styles.trigger}>
            <motion.button {...props} type="button" aria-label={label} whileTap={props.disabled || reducedMotion ? undefined : { scale: .96 }}
                transition={{ type: "spring", stiffness: 520, damping: 34, mass: .7 }}
                className={cn("guan-apple-action inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40", styles.button, className)}>
                <span aria-hidden="true">{icon}</span>
                <span className={styles.label}>{label}</span>
            </motion.button>
        </span>
    </Tooltip>;
}
