// 临界附近的阻尼避免按钮和工具面板反复弹跳；拖动不经过弹簧。
export const APPLE_CONTROL_SPRING = { type: "spring" as const, stiffness: 520, damping: 39, mass: .7 };
export const APPLE_SURFACE_SPRING = { type: "spring" as const, bounce: 0, duration: .28 };
export const APPLE_FADE = { duration: .14, ease: "easeOut" as const };
export const APPLE_POPOVER_TRANSITION = { duration: .22, ease: [.22, 1, .36, 1] as const };
