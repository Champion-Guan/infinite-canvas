// 配置输出是结果的归属关系；按连线方向识别，兼容旧画布、复制与导入。
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ContextMenuState } from "@/types/canvas";

import { connectionSelectionKey, selectedConnection } from "../画布连线/连线关系标识";

export const GENERATED_CONNECTION_DELETE_NOTICE = "生成配置与结果卡片的连线不能单独删除";

export function isGeneratedResultConnection(connection: CanvasConnection | undefined, nodes: readonly CanvasNodeData[]): boolean {
    if (!connection || connection.fromNodeId === connection.toNodeId) return false;
    const source = nodes.find(node => node.id === connection.fromNodeId);
    if (source?.type !== CanvasNodeType.Config) return false;
    const target = nodes.find(node => node.id === connection.toNodeId);
    return target?.type === CanvasNodeType.Image || target?.type === CanvasNodeType.Text
        || target?.type === CanvasNodeType.Video || target?.type === CanvasNodeType.Audio;
}

type Setter<T> = Dispatch<SetStateAction<T>>;
type ConnectionDeletionPort = {
    nodesRef: RefObject<CanvasNodeData[]>;
    connectionsRef: RefObject<CanvasConnection[]>;
    disconnectParameterConnection: (connectionId: string, fromNodeId?: string, toNodeId?: string) => boolean;
    setConnections: Setter<CanvasConnection[]>;
    setSelectedConnectionId: Setter<string | null>;
    setContextMenu: Setter<ContextMenuState | null>;
    message: { info: (options: { key: string; content: string }) => unknown };
};

// 右键、键盘与引用面板共用入口；保护判断必须在任何解绑和状态写入之前。
export function useCanvasConnectionDeletion({ nodesRef, connectionsRef, disconnectParameterConnection, setConnections, setSelectedConnectionId, setContextMenu, message }: ConnectionDeletionPort) {
    return useCallback((connectionId: string) => {
        const connection = selectedConnection(connectionsRef.current, connectionId);
        if (!connection) return;
        if (isGeneratedResultConnection(connection, nodesRef.current)) {
            message.info({ key: "protected-generation-connection", content: GENERATED_CONNECTION_DELETE_NOTICE });
            return;
        }
        if (!disconnectParameterConnection(connection.id, connection.fromNodeId, connection.toNodeId)) setConnections(previous => previous.filter(edge => connectionSelectionKey(edge) !== connectionSelectionKey(connection)));
        setSelectedConnectionId(current => current === connectionId ? null : current);
        setContextMenu(current => current?.type === "connection" && current.connectionId === connectionId ? null : current);
    }, [nodesRef, connectionsRef, disconnectParameterConnection, setConnections, setSelectedConnectionId, setContextMenu, message]);
}
