import type { ReactNode } from "react";
import { ConfigProvider } from "antd";
import { MotionConfig, useReducedMotion } from "motion/react";

// 同一系统偏好同时约束 Motion 与 Ant Design，避免只关闭CSS动画。
export function InterfaceMotionProvider({ children }: { children: ReactNode }) {
    const reducedMotion = useReducedMotion();
    return <MotionConfig reducedMotion="user">
        <ConfigProvider theme={{ token: { motion: !reducedMotion } }}>{children}</ConfigProvider>
    </MotionConfig>;
}
