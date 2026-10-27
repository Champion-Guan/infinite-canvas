type Anchor = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width">;

export function settingsPopoverPosition(anchor: Anchor, placement: string | undefined, viewport: { width: number; height: number }) {
    const margin = Math.min(12, viewport.width / 4, viewport.height / 4), gap = 8;
    const width = Math.max(0, Math.min(356, viewport.width - margin * 2));
    const above = Math.max(0, Math.min(viewport.height - margin, anchor.top - gap) - margin);
    const below = Math.max(0, viewport.height - margin - Math.max(margin, anchor.bottom + gap));
    const preferTop = placement?.startsWith("top") ?? true;
    const top = preferTop ? above >= 260 || above >= below : below < 260 && above > below;
    const proposedLeft = placement === "top" || placement === "bottom" ? anchor.left + anchor.width / 2 - width / 2
        : placement?.endsWith("Right") ? anchor.right - width : anchor.left;
    return {
        width,
        left: Math.max(margin, Math.min(viewport.width - width - margin, proposedLeft)),
        ...(top ? { bottom: Math.max(margin, viewport.height - anchor.top + gap), maxHeight: above }
            : { top: Math.max(margin, anchor.bottom + gap), maxHeight: below }),
        overflowY: "auto" as const,
        boxSizing: "border-box" as const,
    };
}
