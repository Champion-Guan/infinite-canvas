import type { CanvasNodeData } from "@/types/canvas";
import type { HistoryDownloadFile } from "./历史下载文件";

export function historyGridColumns(width: number, minimum: number, gap: number, padding: number) {
    return Math.max(1, Math.floor((width - padding * 2 + gap) / (minimum + gap)));
}

export function historyGridRows<T>(items: readonly T[], columns: number): T[][] {
    const rows: T[][] = [];
    for (let index = 0; index < items.length; index += columns) rows.push(items.slice(index, index + columns));
    return rows;
}

export function includeHistoryFocus(indices: number[], focused: number, count: number) {
    if (focused < 0) return indices;
    const retained = new Set(indices);
    for (let index = Math.max(0, focused - 1); index <= Math.min(count - 1, focused + 1); index++) retained.add(index);
    return [...retained].sort((a, b) => a - b);
}

export type HistoryTaskRow = {
    id: string;
    node: CanvasNodeData;
    kind: "heading" | "file" | "empty";
    file?: HistoryDownloadFile;
    first: boolean;
    last: boolean;
};

export function historyTaskRows(history: CanvasNodeData[], filesByNode: Map<string, HistoryDownloadFile[]>): HistoryTaskRow[] {
    return history.flatMap(node => {
        const files = filesByNode.get(node.id) || [];
        const heading: HistoryTaskRow = { id: `task:${node.id}`, node, kind: files.length ? "heading" : "empty", first: true, last: !files.length };
        if (!files.length) return [heading];
        const rows: HistoryTaskRow[] = files.map((file, index) => ({
            id: `file:${file.id}`, node, file, kind: "file", first: files.length === 1, last: index === files.length - 1,
        }));
        return files.length === 1 ? rows : [heading, ...rows];
    });
}

export function estimateHistoryTaskRow(row: HistoryTaskRow) {
    return (row.kind === "heading" ? 44 : row.kind === "empty" ? 86 : 68) + (row.last ? 12 : 0);
}
