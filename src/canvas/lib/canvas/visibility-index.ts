export type VisibilityBounds = { left: number; top: number; right: number; bottom: number };

// Build only when geometry changes. Oversized curves use a fallback list so a
// long connection cannot allocate millions of cells. Preserve input order.
export function createVisibilityIndex<T>(items: readonly T[], bounds: (item: T) => VisibilityBounds) {
    const cells = new Map<string, number[]>();
    const large: number[] = [];
    const rectangles = items.map(bounds);
    const cellSize = 1024;
    rectangles.forEach((rect, index) => {
        const x0 = Math.floor(rect.left / cellSize), x1 = Math.floor(rect.right / cellSize);
        const y0 = Math.floor(rect.top / cellSize), y1 = Math.floor(rect.bottom / cellSize);
        if (!Object.values(rect).every(Number.isFinite) || (x1 - x0 + 1) * (y1 - y0 + 1) > 64) { large.push(index); return; }
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
            const key = `${x},${y}`;
            const list = cells.get(key);
            if (list) list.push(index); else cells.set(key, [index]);
        }
    });
    let previous: T[] = [];
    return (view: VisibilityBounds): T[] => {
        const x0 = Math.floor(view.left / cellSize), x1 = Math.floor(view.right / cellSize);
        const y0 = Math.floor(view.top / cellSize), y1 = Math.floor(view.bottom / cellSize);
        const candidates = new Set(large);
        // Extreme zoom-out is cheaper as one bounded pass than a huge grid walk.
        if (!Object.values(view).every(Number.isFinite) || (x1 - x0 + 1) * (y1 - y0 + 1) > 4096) {
            items.forEach((_, index) => candidates.add(index));
        } else {
            for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++)
                cells.get(`${x},${y}`)?.forEach(index => candidates.add(index));
        }
        const visible = [...candidates].sort((a, b) => a - b).filter(index => {
            const rect = rectangles[index];
            return rect.right > view.left && rect.left < view.right && rect.bottom > view.top && rect.top < view.bottom;
        }).map(index => items[index]);
        if (visible.length === previous.length && visible.every((item, index) => item === previous[index])) return previous;
        previous = visible;
        return visible;
    };
}
