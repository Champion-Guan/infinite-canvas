export type FloatingRect = { left: number; top: number; right: number; bottom: number };
export const CANVAS_FLOATING_CHANGE = "guan-canvas-floating-change";
export const CANVAS_PANEL_REVEAL = "guan-canvas-panel-reveal";

export function floatingBounds(view: FloatingRect, canvas?: FloatingRect | null, dock?: FloatingRect | null) {
    const left = Math.max(view.left, canvas?.left ?? view.left) + 12;
    const top = Math.max(view.top, canvas ? canvas.top + 64 : view.top) + 12;
    const right = Math.max(left + 1, Math.min(view.right, canvas?.right ?? view.right) - 12);
    const bottom = Math.max(top + 1, Math.min(view.bottom, canvas?.bottom ?? view.bottom, dock?.top ?? Infinity) - 12);
    return { left, top, right, bottom };
}

export function fitFloatingRect(rect: FloatingRect, bounds: FloatingRect) {
    const width = Math.min(rect.right - rect.left, bounds.right - bounds.left);
    const height = Math.min(rect.bottom - rect.top, bounds.bottom - bounds.top);
    const left = Math.max(bounds.left, Math.min(rect.left, bounds.right - width));
    const top = Math.max(bounds.top, Math.min(rect.top, bounds.bottom - height));
    return { left, top, width, height };
}

export function revealCanvasPanel(view: { x: number; y: number; k: number }, node: { position: { x: number; y: number }; width: number; height: number }, bounds: FloatingRect, canvas: FloatingRect) {
    const height = bounds.bottom - bounds.top, width = bounds.right - bounds.left;
    const cardHeight = Math.max(24, height * .38 - 48);
    const k = Math.min(view.k, cardHeight / Math.max(node.height, 1), (width - 24) / Math.max(node.width, 1));
    return { k, x: (bounds.left + bounds.right) / 2 - canvas.left - (node.position.x + node.width / 2) * k,
        y: bounds.top + 60 - canvas.top - node.position.y * k };
}

export function placeCanvasPanel(anchor: FloatingRect, size: { width: number; height: number }, bounds: FloatingRect, toolbar?: FloatingRect) {
    const sideTop = Math.max(bounds.top, anchor.top);
    const spaces = [
        { ...bounds, top: Math.max(bounds.top, anchor.bottom + 12), side: "bottom" },
        { ...bounds, bottom: Math.min(bounds.bottom, anchor.top - 12, toolbar ? toolbar.top - 12 : Infinity), side: "top" },
        { ...bounds, top: sideTop, left: Math.max(bounds.left, anchor.right + 12), side: "right" },
        { ...bounds, top: sideTop, right: Math.min(bounds.right, anchor.left - 12), side: "left" },
    ].map(space => {
        if (!toolbar || (space.side !== "right" && space.side !== "left")) return space;
        const overlapsX = toolbar.left < space.right && toolbar.right > space.left;
        return overlapsX && toolbar.bottom > space.top ? { ...space, top: Math.max(space.top, toolbar.bottom + 12) } : space;
    }).filter(space => space.right > space.left && space.bottom > space.top);
    const full = spaces.find(space => space.right - space.left >= size.width && space.bottom - space.top >= size.height);
    // 缩窄或缩短编辑器也不能跨进卡片及其工具栏；优先保留可阅读的宽度和操作区。
    const score = (space: typeof spaces[number]) => {
        const width = Math.min(size.width, space.right - space.left), height = Math.min(size.height, space.bottom - space.top);
        return width * height * (width >= 280 ? 1 : .15) * (height >= 140 ? 1 : .15);
    };
    const space = full ?? spaces.reduce<(typeof spaces)[number] | undefined>((best, current) => !best || score(current) > score(best) ? current : best, undefined);
    if (!space) return { left: bounds.right, top: bounds.top, width: 0, height: 0, side: "unavailable" };
    const width = Math.min(size.width, space.right - space.left), height = Math.min(size.height, space.bottom - space.top);
    const x = space.side === "right" ? space.left : space.side === "left" ? space.right - width : (anchor.left + anchor.right - width) / 2;
    const y = space.side === "top" ? space.bottom - height : space.top;
    return { ...fitFloatingRect({ left: x, top: y, right: x + width, bottom: y + height }, space), side: space.side };
}

export function placeCanvasSettings(card: FloatingRect, size: { width: number; height: number }, bounds: FloatingRect, toolbar?: FloatingRect) {
    const width = Math.min(size.width, bounds.right - bounds.left);
    const candidates = [
        { left: card.right + 12, side: "right" },
        { left: card.left - width - 12, side: "left" },
    ].filter(item => item.left >= bounds.left && item.left + width <= bounds.right).map(item => {
        let top = Math.max(bounds.top, Math.min(card.top, bounds.bottom - Math.min(size.height, 280)));
        if (toolbar && toolbar.left < item.left + width && toolbar.right > item.left && toolbar.bottom > top)
            top = Math.max(top, toolbar.bottom + 12);
        return { ...item, top, width, height: Math.max(0, Math.min(size.height, bounds.bottom - top)) };
    });
    const side = candidates.find(item => item.height >= Math.min(size.height, 280));
    if (side) return side;
    return placeCanvasPanel(card, { ...size, width }, bounds, toolbar);
}

export function readCanvasFloatingBounds(anchor: Element | null): FloatingRect {
    const visual = window.visualViewport;
    const view = { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0,
        right: (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth),
        bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight) };
    // 全局设置和模态框使用浏览器边界；画布内浮层使用当前产品的可见画布。
    if (anchor?.closest('.ant-modal,.ant-drawer,[role="alertdialog"]')) return floatingBounds(view);
    const product = anchor?.closest('[data-product-id]') ?? document.querySelector('[data-product-active="true"]');
    const canvas = product?.querySelector('.guan-canvas-viewport');
    const dock = product?.querySelector('[data-canvas-bottom-toolbar]');
    return floatingBounds(view, canvas?.getBoundingClientRect(), dock?.getBoundingClientRect());
}
