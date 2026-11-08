export class ProductPromptBlockedError extends Error {
    constructor(message: string, readonly promptIds: readonly string[]) {
        super(message);
        this.name = "ProductPromptBlockedError";
    }
}

const warnings = new Set<{ ids: ReadonlySet<string>; play(): boolean }>();

export function registerProductPromptWarning(ids: readonly string[], play: () => boolean) {
    const warning = { ids: new Set(ids), play };
    warnings.add(warning);
    return () => { warnings.delete(warning); };
}

// 只有对应的常驻框确实给出反馈时才消费错误；未挂载时保留普通错误提示。
export function pulseProductPromptWarning(error: unknown) {
    if (!(error instanceof ProductPromptBlockedError)) return false;
    let handled = false;
    for (const warning of warnings) {
        if (!error.promptIds.some(id => warning.ids.has(id))) continue;
        try { handled = warning.play() || handled; } catch { /* 动画失败不吞掉原错误。 */ }
    }
    return handled;
}

export function createPromptWarningMotion(element: HTMLElement) {
    let animation: Animation | null = null;
    return {
        play() {
            if (!element.isConnected || typeof element.animate !== "function") return false;
            const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const current = getComputedStyle(element).translate;
            animation?.cancel();
            // 使用独立translate，不覆盖消息框本身的进入/退出transform。
            const next = element.animate(reduced
                ? [{ opacity: .72 }, { opacity: 1 }]
                : [{ translate: current === "none" ? "0px" : current || "0px" },
                    { translate: "-8px" }, { translate: "7px" }, { translate: "-5px" },
                    { translate: "3px" }, { translate: "-1px" }, { translate: "0px" }],
            { duration: reduced ? 160 : 420, easing: "ease-out" });
            animation = next;
            next.onfinish = () => { if (animation === next) animation = null; };
            return true;
        },
        dispose() { animation?.cancel(); animation = null; },
    };
}
