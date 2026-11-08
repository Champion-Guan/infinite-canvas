import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { defaultRangeExtractor, observeElementRect, useVirtualizer } from "./虚拟列表依赖";
import { historyGridColumns, historyGridRows, includeHistoryFocus } from "./历史虚拟化规则";

type Props<T> = {
    items: readonly T[];
    getKey: (item: T) => string;
    children: (item: T, index: number) => ReactNode;
    estimateSize: number | ((item: T) => number);
    label: string;
    className?: string;
    gap?: number;
    paddingX?: number;
    paddingY?: number;
    minColumnWidth?: number;
    resetKey?: unknown;
    offsetRef?: RefObject<number>;
    animateSort?: boolean;
};

export function HistoryVirtualList<T>({ items, getKey, children, estimateSize, label, className, gap = 0, paddingX = 0, paddingY = 0, minColumnWidth, resetKey, offsetRef, animateSort = false }: Props<T>) {
    const container = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const [focusedKey, setFocusedKey] = useState<string | null>(null);
    const previousResetKey = useRef(resetKey);
    const columns = minColumnWidth ? Math.min(Math.max(1, items.length), historyGridColumns(width, minColumnWidth, gap, paddingX)) : 1;
    const rows = useMemo(() => historyGridRows(items, columns), [items, columns]);
    const keys = useMemo(() => rows.map(row => getKey(row[0])), [rows, getKey]);
    const focusedIndex = focusedKey === null ? -1 : keys.indexOf(focusedKey);
    const keyAt = useCallback((index: number) => keys[index], [keys]);
    const estimate = useCallback((index: number) => typeof estimateSize === "number" ? estimateSize : Math.max(...rows[index].map(estimateSize)), [rows, estimateSize]);
    const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => includeHistoryFocus(defaultRangeExtractor(range), focusedIndex, rows.length), [focusedIndex, rows.length]);
    const observeSize: typeof observeElementRect = useCallback((instance, callback) => observeElementRect(instance, rect => { setWidth(rect.width); callback(rect); }), []);
    const virtualizer = useVirtualizer({
        count: rows.length, getScrollElement: () => container.current, getItemKey: keyAt, estimateSize: estimate,
        rangeExtractor, overscan: minColumnWidth ? 1 : 4, gap, paddingStart: paddingY, paddingEnd: paddingY,
        initialRect: { width: 0, height: 480 }, initialOffset: () => offsetRef?.current ?? 0,
        observeElementRect: observeSize,
        onChange: instance => { if (offsetRef) offsetRef.current = instance.scrollOffset ?? 0; },
    });
    useLayoutEffect(() => { virtualizer.measure(); }, [width, columns, virtualizer]);
    useLayoutEffect(() => {
        if (previousResetKey.current !== resetKey) {
            previousResetKey.current = resetKey;
            virtualizer.scrollToOffset(0);
        }
        const element = container.current;
        if (element && element.scrollTop > Math.max(0, virtualizer.getTotalSize() - element.clientHeight))
            virtualizer.scrollToOffset(Math.max(0, virtualizer.getTotalSize() - element.clientHeight));
    }, [resetKey, rows.length, width, virtualizer]);
    const visible = virtualizer.getVirtualItems();
    return <div ref={container} className={className} role="list" aria-label={label} tabIndex={0}
        data-history-virtual-list={label} data-history-total={items.length} data-history-rendered={visible.length}
        style={{ overflowY: "auto", overflowAnchor: "none", scrollBehavior: "auto", paddingInline: paddingX }}
        onFocusCapture={event => {
            const row = event.target.closest<HTMLElement>("[data-history-virtual-key]");
            setFocusedKey(row?.dataset.historyVirtualKey ?? null);
        }}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedKey(null); }}>
        <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
            {visible.map(row => <div key={row.key} data-index={row.index} data-history-virtual-key={row.key} data-history-sort-key={animateSort && !minColumnWidth ? row.key : undefined} ref={virtualizer.measureElement}
                role={minColumnWidth ? undefined : "listitem"} aria-posinset={minColumnWidth ? undefined : row.index + 1} aria-setsize={minColumnWidth ? undefined : items.length}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)`, ...(minColumnWidth ? { display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap, alignItems: "start" } : {}) }}>
                {minColumnWidth ? rows[row.index].map((item, column) =>
                    <div key={getKey(item)} data-history-sort-key={animateSort ? getKey(item) : undefined} role="listitem" aria-posinset={row.index * columns + column + 1} aria-setsize={items.length}>{children(item, row.index * columns + column)}</div>)
                    : children(rows[row.index][0], row.index)}
            </div>)}
        </div>
    </div>;
}
