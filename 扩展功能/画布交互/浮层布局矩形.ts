import type { FloatingRect } from "./浮层可见区域";

const identity = { a: 1, d: 1, e: 0, f: 0 };
function matrix(value?: string) {
    if (!value || value === "none") return identity;
    try { return new DOMMatrixReadOnly(value); } catch { return identity; }
}
function scale(value?: string) {
    const parts = value?.split(" ").map(item => parseFloat(item) / (item.endsWith("%") ? 100 : 1));
    return parts?.length && parts.every(Number.isFinite) ? [parts[0], parts[1] ?? parts[0]] : [1, 1];
}

// 使用入场结束时的布局占位做边界计算；当前scale/translate只影响绘制，不影响避让。
export function floatingLayoutRect(node: HTMLElement) {
    const visual = node.getBoundingClientRect(), style = getComputedStyle(node);
    const current = matrix(style.transform), currentScale = scale(style.scale);
    let final = current, finalScale = currentScale;
    for (const animation of node.getAnimations?.() ?? []) {
        const effect = animation.effect;
        if (!(effect instanceof KeyframeEffect) || effect.target !== node) continue;
        const frames = effect.getKeyframes(), last = frames.at(-1);
        if (last?.transform !== undefined) final = matrix(String(last.transform));
        if (last?.scale !== undefined) finalScale = scale(String(last.scale));
    }
    const sx = current.a * currentScale[0] || 1, sy = current.d * currentScale[1] || 1;
    const fx = final.a * finalScale[0], fy = final.d * finalScale[1];
    const parentX = node.offsetWidth ? visual.width / node.offsetWidth / sx : 1;
    const parentY = node.offsetHeight ? visual.height / node.offsetHeight / sy : 1;
    const origin = style.transformOrigin?.split(" ").map(parseFloat) ?? [0, 0];
    const left = visual.left + ((origin[0] || 0) * (sx - fx) + final.e - current.e) * parentX;
    const top = visual.top + ((origin[1] || 0) * (sy - fy) + final.f - current.f) * parentY;
    return { rect: { left, top, right: left + visual.width / sx * fx, bottom: top + visual.height / sy * fy } as FloatingRect,
        parentX: parentX || 1, parentY: parentY || 1 };
}
