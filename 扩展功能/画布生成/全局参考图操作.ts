// 只补齐当前图片到配置的连线，立即同步原引用以阻止重复点击。
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import { nanoid } from "nanoid";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type GlobalReferencePort = {
    nodesRef: RefObject<CanvasNodeData[]>;
    connectionsRef: RefObject<CanvasConnection[]>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    message: MessageInstance;
};

export function useGlobalImageReference({ nodesRef, connectionsRef, setConnections, message }: GlobalReferencePort) {
    return useCallback((requestedNode: CanvasNodeData) => {
        const imageNode = nodesRef.current.find(node => node.id === requestedNode.id);
        if (!imageNode) return;
        if (imageNode.type !== CanvasNodeType.Image || !imageNode.metadata?.content) return;
        const configIds = nodesRef.current.filter(node => node.type === CanvasNodeType.Config).map(node => node.id);
        if (!configIds.length) {
            message.info("画布上暂时没有生成配置卡片");
            return;
        }
        const existing = new Set(connectionsRef.current.filter(connection => connection.fromNodeId === imageNode.id).map(connection => connection.toNodeId));
        const additions = configIds.filter(configId => !existing.has(configId)).map(configId => ({ id: nanoid(), fromNodeId: imageNode.id, toNodeId: configId }));
        if (!additions.length) {
            message.info("该图片已经连接到所有生成配置卡片");
            return;
        }
        const nextConnections = [...connectionsRef.current, ...additions];
        connectionsRef.current = nextConnections;
        setConnections(nextConnections);
        message.success(`已将图片连接到 ${additions.length} 个生成配置卡片`);
    }, [nodesRef, connectionsRef, setConnections, message]);
}
