const TOOLBAR_HEIGHT = 48;
const OUTSIDE_GAP = 14;
const INSIDE_GAP = 10;
// 工具栏挂在画布内容层内，该层本身已经从页面标题区下方开始。
// 这里不能再次扣除页面级64px，否则会把本来能放在卡片上方的工具栏
// 误判为“顶部不可用”，提前塞回卡片内部。
const CANVAS_CONTENT_TOP = 0;

type ToolbarViewport = { x: number; y: number; k: number };

export function nodeToolbarTop(nodeTop: number) {
    const outsideTop = nodeTop - OUTSIDE_GAP - TOOLBAR_HEIGHT;
    return outsideTop >= CANVAS_CONTENT_TOP
        ? outsideTop
        : Math.max(CANVAS_CONTENT_TOP, nodeTop + INSIDE_GAP);
}

// 与原视区绘制共用一次回调，不依赖React提交频率，也不额外启动逐帧循环。
export function paintNodeToolbar(root: HTMLElement | null, viewport: ToolbarViewport) {
    if (!root) return;
    for (const toolbar of root.querySelectorAll<HTMLElement>("[data-node-toolbar]")) {
        const { toolbarNodeX, toolbarNodeY, toolbarNodeWidth } = toolbar.dataset;
        const x = Number(toolbarNodeX), y = Number(toolbarNodeY), width = Number(toolbarNodeWidth);
        if (![x, y, width].every(Number.isFinite)) continue;
        toolbar.style.left = `${viewport.x + (x + width / 2) * viewport.k}px`;
        toolbar.style.top = `${nodeToolbarTop(viewport.y + y * viewport.k + Number(toolbar.dataset.toolbarNodeOffsetY || 0))}px`;
    }
}
