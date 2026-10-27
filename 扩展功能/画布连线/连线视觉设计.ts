// 连线自己的视觉规范，不覆盖工作台主题、按钮和卡片样式。
export const connectionDesign = {
    cornerRadius: 14,
    lineWidth: 1.8,
    focusWidth: 2.6,
    focusColor: "#2f80ff",
    light: { line: "#78746d", opacity: 0.85, contextOpacity: 0.48 },
    dark: { line: "#bab5ab", opacity: 0.85, contextOpacity: 0.48 },
} as const;

// 使用画布单位，交给画布统一缩放，不再反向补偿线宽和命中范围。
export function connectionScreenMetrics(_scale: number) {
    return { line: connectionDesign.lineWidth, focus: connectionDesign.focusWidth, hit: 24, backdrop: 4.4 };
}
