const TOOLBAR_HEIGHT = 48;
const OUTSIDE_GAP = 14;
const INSIDE_GAP = 10;
// 顶部画布标题区占用64px；只在外侧工具栏会进入该区域时改为图内位置。
const CANVAS_HEADER_BOTTOM = 64;

type ToolbarViewport = { x: number; y: number; k: number };

export function nodeToolbarTop(nodeTop: number) {
    const outsideTop = nodeTop - OUTSIDE_GAP - TOOLBAR_HEIGHT;
    return outsideTop >= CANVAS_HEADER_BOTTOM
        ? outsideTop
        : Math.max(CANVAS_HEADER_BOTTOM, nodeTop + INSIDE_GAP);
}

// 与原视区绘制共用一次回调，不依赖React提交频率，也不额外启动逐帧循环。
export function paintNodeToolbar(root: HTMLElement | null, viewport: ToolbarViewport) {
    const toolbar = root?.querySelector<HTMLElement>("[data-node-toolbar]");
    if (!toolbar) return;
    const { toolbarNodeX, toolbarNodeY, toolbarNodeWidth } = toolbar.dataset;
    const x = Number(toolbarNodeX), y = Number(toolbarNodeY), width = Number(toolbarNodeWidth);
    if (![x, y, width].every(Number.isFinite)) return;
    toolbar.style.left = `${viewport.x + (x + width / 2) * viewport.k}px`;
    toolbar.style.top = `${nodeToolbarTop(viewport.y + y * viewport.k)}px`;
}
