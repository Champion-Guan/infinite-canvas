import type { ReactNode } from "react";
import { ConfigProvider } from "antd";
import { MotionConfig, useReducedMotion } from "motion/react";
import { APPLE_CONTROL_SPRING } from "./苹果动效";
import "./滚动区域留白.css";

// 同一系统偏好同时约束 Motion 与 Ant Design，避免只关闭CSS动画。
export function InterfaceMotionProvider({ children }: { children: ReactNode }) {
    const reducedMotion = useReducedMotion();
    return <MotionConfig reducedMotion="user" transition={APPLE_CONTROL_SPRING}>
        <ConfigProvider theme={{ token: {
            motion: !reducedMotion,
            motionDurationFast: "0.14s", motionDurationMid: "0.22s", motionDurationSlow: "0.32s",
            motionEaseOut: "cubic-bezier(0.22,1,0.36,1)", motionEaseInOut: "cubic-bezier(0.25,0.8,0.25,1)",
        }, components: { Tabs: { motionDurationSlow: "0.18s" } } }}>{children}</ConfigProvider>
    </MotionConfig>;
}
