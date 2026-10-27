// 参数卡创建、绑定和解绑共用原节点/连线事务；不接管作者普通连线和选择状态。
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";
import type { ProductExcelContext } from "./Excel卡片上下文";
import { bindExcelParameters, createProductParameterNode, disconnectExcelParameters, type Factory } from "./Excel卡片事务";
import { readProductParameterValues } from "./Excel参数记忆";

type ExcelParameterPort = {
    projectId: string;
    excelContext: ProductExcelContext;
    nodesRef: RefObject<CanvasNodeData[]>;
    connectionsRef: RefObject<CanvasConnection[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    factory: Factory;
};
export function useExcelParameterOperations({ projectId, excelContext, nodesRef, connectionsRef, setNodes, setConnections, factory }: ExcelParameterPort) {
    const createParameterNode = useCallback((center: Position) => {
        return createProductParameterNode(excelContext, center, readProductParameterValues(projectId), factory);
    }, [excelContext, projectId, factory]);

    const commit = useCallback((result: { nodes: CanvasNodeData[]; connections: CanvasConnection[] } | null) => {
        if (!result) return false;
        setNodes(result.nodes);
        connectionsRef.current = result.connections;
        setConnections(result.connections);
        return true;
    }, [setNodes, connectionsRef, setConnections]);

    const bindParameterConnection = useCallback((fromNodeId: string, toNodeId: string, nodes = nodesRef.current) => {
        return commit(bindExcelParameters(nodes, connectionsRef.current, fromNodeId, toNodeId, factory));
    }, [nodesRef, connectionsRef, factory, commit]);

    const disconnectParameterConnection = useCallback((connectionId: string, fromNodeId?: string, toNodeId?: string) => {
        return commit(disconnectExcelParameters(nodesRef.current, connectionsRef.current, connectionId, edge => edge.id === connectionId && (!fromNodeId || edge.fromNodeId === fromNodeId) && (!toNodeId || edge.toNodeId === toNodeId)));
    }, [nodesRef, connectionsRef, commit]);

    return { createParameterNode, bindParameterConnection, disconnectParameterConnection };
}
