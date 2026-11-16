// 缩小时逐级隐藏次级网格，避免2~3px密网格反复重绘与视觉摩尔纹。
export function canvasGridStep(scale: number) {
    const step = 48 * scale;
    return step * 2 ** Math.max(0, Math.ceil(Math.log2(12 / step)));
}
