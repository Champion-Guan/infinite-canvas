import { useMemo, useRef, useState } from "react";
import type { HistoryDownloadFile } from "./历史下载文件";

export function toggleHistoryFileIds(selected: Set<string>, ids: string[], checked?: boolean) {
    const next = new Set(selected);
    const select = checked ?? !ids.every(id => selected.has(id));
    for (const id of ids) { if (select) next.add(id); else next.delete(id); }
    return next;
}

// 文件ID沿用下载清单的节点/槽位组合，批次可只勾选其中一张。
export function useHistorySelection(files: HistoryDownloadFile[], busy: boolean) {
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const overviewStartedSelection = useRef(false);
    const selectedFiles = useMemo(() => files.filter(file => selectedIds.has(file.id)), [files, selectedIds]);
    const validIds = new Set(files.map(file => file.id));
    const selectFiles = (ids: string[], checked?: boolean) => {
        if (busy) return;
        const valid = ids.filter(id => validIds.has(id));
        setSelectedIds(previous => toggleHistoryFileIds(previous, valid, checked));
    };
    const toggleSelectionMode = () => {
        if (busy) return;
        overviewStartedSelection.current = false;
        setSelectionMode(!selectionMode);
        setSelectedIds(selectionMode ? new Set() : new Set(validIds));
    };
    const beginOverviewSelection = () => {
        if (!selectionMode) {
            overviewStartedSelection.current = true;
            setSelectionMode(true); setSelectedIds(new Set());
        }
    };
    const endOverviewSelection = () => {
        if (!overviewStartedSelection.current) return;
        overviewStartedSelection.current = false;
        // 下载已捕获自己的文件清单，关闭总览仍可退出临时勾选，不中止下载。
        setSelectionMode(false); setSelectedIds(new Set());
    };
    return { selectionMode, selectedFiles, selectedIds, selectFiles, toggleSelectionMode, beginOverviewSelection, endOverviewSelection };
}
