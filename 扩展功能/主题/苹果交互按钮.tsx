import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { Button } from "antd";
import type { ComponentProps } from "react";
import { APPLE_CONTROL_SPRING } from "./苹果动效";

const MotionButton = motion.create(Button);

export function AppleActionButton({ type = "button", disabled, whileTap, transition, ...props }: HTMLMotionProps<"button">) {
    const reduced = useReducedMotion();
    return <motion.button {...props} type={type} disabled={disabled}
        whileTap={disabled || reduced ? undefined : whileTap ?? { scale: .96 }}
        transition={reduced ? { duration: 0 } : transition ?? APPLE_CONTROL_SPRING} />;
}

export function AppleAntButton({ disabled, ...props }: ComponentProps<typeof MotionButton>) {
    const reduced = useReducedMotion();
    return <MotionButton {...props} disabled={disabled}
        whileTap={disabled || reduced ? undefined : { scale: .96 }}
        transition={reduced ? { duration: 0 } : APPLE_CONTROL_SPRING} />;
}
