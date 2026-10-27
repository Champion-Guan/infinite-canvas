export type PickerBox = { left: number; top: number; right: number; bottom: number };
const overlap = (a: PickerBox, b: PickerBox) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

// 同时评估整组关系，预览不同条目时不移动面板，避免鼠标追逐。
export function placeConnectionPicker(view: PickerBox, size: { width: number; height: number }, anchor: { x: number; y: number }, cards: readonly PickerBox[], lines: readonly PickerBox[], protectedCards: readonly PickerBox[] = []) {
    const width = Math.min(size.width, view.right - view.left), height = Math.min(size.height, view.bottom - view.top);
    const xs = new Set([view.left, view.right - width, anchor.x + 16, anchor.x - width - 16]);
    const ys = new Set([view.top, view.bottom - height, anchor.y + 16, anchor.y - height - 16]);
    for (const box of [...cards, ...lines.slice(0, 24)]) { xs.add(box.right + 16); xs.add(box.left - width - 16); ys.add(box.bottom + 16); ys.add(box.top - height - 16); }
    for (let x = view.left; x <= view.right - width; x += 64) xs.add(x);
    for (let y = view.top; y <= view.bottom - height; y += 64) ys.add(y);
    let best = { left: view.left, top: view.top, score: Infinity, protectedArea: Infinity };
    for (const x of xs) for (const y of ys) {
        const left = Math.max(view.left, Math.min(x, view.right - width)), top = Math.max(view.top, Math.min(y, view.bottom - height));
        const box = { left, top, right: left + width, bottom: top + height };
        const cardArea = cards.reduce((sum, card) => sum + overlap(box, card), 0);
        const lineArea = lines.reduce((sum, line) => sum + overlap(box, line), 0);
        const distance = Math.hypot(left + width / 2 - anchor.x, top + height / 2 - anchor.y);
        const score = (cardArea + lineArea * 4) * 10000 + distance;
        const protectedArea = protectedCards.reduce((sum, card) => sum + overlap(box, card), 0);
        if (protectedArea < best.protectedArea || (protectedArea === best.protectedArea && score < best.score)) best = { left, top, score, protectedArea };
    }
    return { left: best.left, top: best.top };
}
