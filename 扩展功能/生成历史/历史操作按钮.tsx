import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Tooltip } from "antd";
import { cn } from "@/lib/utils";
import styles from "./历史操作栏.module.css";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title"> & {
    label: string;
    description: string;
    icon: ReactNode;
};

// 文字由侧栏容器宽度控制；禁用时仍可通过外层触发说明。
export function HistoryActionButton({ label, description, icon, className, ...props }: Props) {
    return <Tooltip title={description} trigger={["hover", "focus"]} mouseEnterDelay={0.25}>
        <span className={styles.trigger}>
            <button {...props} type="button" aria-label={label} className={cn("guan-apple-action guan-apple-press inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40", styles.button, className)}>
                <span aria-hidden="true">{icon}</span>
                <span className={styles.label}>{label}</span>
            </button>
        </span>
    </Tooltip>;
}
