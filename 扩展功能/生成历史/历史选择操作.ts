import { useMemo, useState } from "react";
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
    const selectedFiles = useMemo(() => files.filter(file => selectedIds.has(file.id)), [files, selectedIds]);
    const validIds = new Set(files.map(file => file.id));
    const selectFiles = (ids: string[], checked?: boolean) => {
        if (busy) return;
        const valid = ids.filter(id => validIds.has(id));
        setSelectedIds(previous => toggleHistoryFileIds(previous, valid, checked));
    };
    const toggleSelectionMode = () => {
        if (busy) return;
        setSelectionMode(!selectionMode);
        setSelectedIds(selectionMode ? new Set() : new Set(validIds));
    };
    const beginOverviewSelection = () => {
        if (!selectionMode) { setSelectionMode(true); setSelectedIds(new Set()); }
    };
    return { selectionMode, selectedFiles, selectedIds, selectFiles, toggleSelectionMode, beginOverviewSelection };
}
