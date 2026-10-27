import type { Dispatch, RefObject, SetStateAction } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

// 自有操作共用原画布历史，不建立第二份节点或撤销状态。
export type CanvasHistorySnapshot = { nodes: CanvasNodeData[]; connections: CanvasConnection[] };
export type CanvasHistoryPort<T extends CanvasHistorySnapshot> = {
    projectId: string;
    nodesRef: RefObject<CanvasNodeData[]>;
    historyRef: RefObject<{ past: T[]; future: T[] }>;
    createHistoryEntry: () => T;
    applyHistory: (entry: T) => void;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    assertImportTarget: () => void;
    message: MessageInstance;
};
