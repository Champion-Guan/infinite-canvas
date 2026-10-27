// Excel 来源同步与插入接线；共用原画布状态，纯卡片事务仍由 Excel卡片事务 实现。
import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";
import type { ProductExcelContext } from "./Excel卡片上下文";
import { insertExcelPromptCards, type ExcelInsertRequest, type Factory } from "./Excel卡片事务";
import { syncExcelPromptNodes } from "./旧版提示词同步";
import { parseExcelPromptDrop } from "./Excel拖入校验";

type ExcelInsertionPort = {
    projectId: string;
    productActive: boolean;
    projectLoaded: boolean;
    restoredProjectIdRef: RefObject<string | null>;
    excelContext: ProductExcelContext;
    nodesRef: RefObject<CanvasNodeData[]>;
    connectionsRef: RefObject<CanvasConnection[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    getCanvasCenter: () => Position;
    factory: Factory;
    message: MessageInstance;
};
function confirmExcelOverwrite(node: CanvasNodeData) {
    return window.confirm(`「${node.title || "提示词"}」已手动修改，是否使用 Excel 新内容覆盖？`);
}

export function useExcelCanvasInsertion({ projectId, productActive, projectLoaded, restoredProjectIdRef, excelContext,
    nodesRef, connectionsRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, getCanvasCenter, factory, message }: ExcelInsertionPort) {
    const insertExcelCards = useCallback((request: ExcelInsertRequest, center?: Position) => {
        if (!productActive || !projectLoaded || restoredProjectIdRef.current !== projectId || excelContext.productId !== projectId) return;
        try {
            const result = insertExcelPromptCards(nodesRef.current, connectionsRef.current, excelContext, request,
                center || getCanvasCenter(), factory, confirmExcelOverwrite, syncExcelPromptNodes);
            setNodes(result.nodes);
            connectionsRef.current = result.connections;
            setConnections(result.connections);
            setSelectedNodeIds(new Set(result.selectedIds));
            setSelectedConnectionId(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Excel提示词插入失败，原画布保留");
        }
    }, [productActive, projectLoaded, restoredProjectIdRef, projectId, excelContext, nodesRef, connectionsRef,
        getCanvasCenter, factory, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, message]);

    useEffect(() => {
        if (!projectLoaded || restoredProjectIdRef.current !== projectId || excelContext.productId !== projectId) return;
        const next = syncExcelPromptNodes(nodesRef.current, excelContext, node => productActive ? confirmExcelOverwrite(node) : undefined);
        if (next !== nodesRef.current) setNodes(next);
    }, [excelContext, projectLoaded, productActive, projectId, restoredProjectIdRef, nodesRef, setNodes]);

    const dropExcelCards = useCallback((raw: string, center: Position) => {
        try {
            const request = parseExcelPromptDrop(raw);
            if (!request) return false;
            insertExcelCards(request, center);
        } catch (error) {
            message.warning(error instanceof Error ? error.message : "Excel拖入失败");
        }
        return true;
    }, [insertExcelCards, message]);

    return { insertExcelCards, dropExcelCards };
}
