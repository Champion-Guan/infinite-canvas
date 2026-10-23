// 所有节点写入共用当前事务；原始恢复不触发新增卡片避让。
import { useCallback, useRef, useState } from "react";
import type { CanvasNodeData } from "@/types/canvas";
import { reconcileExcelPreviews } from "../Excel画布/Excel卡片事务";
import { placeNewCanvasNodes } from "../画布布局/卡片自动避让";

export function useCanvasNodeTransactions() {
    const [nodes, setNodeState] = useState<CanvasNodeData[]>([]);
    const nodesRef = useRef(nodes);
    const nodeTransactionRef = useRef(nodes);
    const getCurrentNode = useCallback((id: string) => nodesRef.current.find(node => node.id === id), []);
    const setRawNodes = useCallback((next: CanvasNodeData[]) => {
        nodeTransactionRef.current = next;
        nodesRef.current = next;
        setNodeState(next);
    }, []);
    const setNodes = useCallback((update: CanvasNodeData[] | ((previous: CanvasNodeData[]) => CanvasNodeData[])) => {
        const previous = nodeTransactionRef.current;
        setRawNodes(placeNewCanvasNodes(previous, reconcileExcelPreviews(previous, typeof update === "function" ? update(previous) : update)));
    }, [setRawNodes]);
    return { nodes, nodesRef, nodeTransactionRef, getCurrentNode, setRawNodes, setNodes };
}
