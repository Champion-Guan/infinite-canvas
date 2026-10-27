// 提示词工具栏的「用文本生图」只创建配置快照，不发送模型请求。
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { getNodeSpec } from "@/constant/canvas";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { detectedPromptConfig } from "./生成参数继承";
import { nanoid } from "nanoid";

type SingleConfigPort = {
    nodesRef: RefObject<CanvasNodeData[]>;
    connectionsRef: RefObject<CanvasConnection[]>;
    effectiveConfig: AiConfig;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    message: MessageInstance;
    emptyPromptMessage: string;
};
export function useSinglePromptConfig({ nodesRef, connectionsRef, effectiveConfig, setNodes, setConnections,
    setSelectedNodeIds, setSelectedConnectionId, setDialogNodeId, message, emptyPromptMessage }: SingleConfigPort) {
    return useCallback((node: CanvasNodeData) => {
        const source = nodesRef.current.find(item => item.id === node.id);
        if (!source) return;
        const prompt = (source.metadata?.content || source.metadata?.prompt || "").trim();
        if (!prompt) { message.warning(emptyPromptMessage); return; }
        const size = getNodeSpec(CanvasNodeType.Config);
        const configNode = createCanvasNode(CanvasNodeType.Config,
            { x: source.position.x + source.width + 96 + size.width / 2, y: source.position.y + source.height / 2 },
            { prompt: "", ...detectedPromptConfig(source, nodesRef.current, connectionsRef.current, effectiveConfig) });
        const nextNodes = nodesRef.current.map(item => item.id === source.id
            ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: "success" as const } } : item).concat(configNode);
        setNodes(nextNodes);
        const nextConnections = [...connectionsRef.current, { id: nanoid(), fromNodeId: source.id, toNodeId: configNode.id }];
        connectionsRef.current = nextConnections;
        setConnections(nextConnections);
        setSelectedNodeIds(new Set([configNode.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(configNode.id);
    }, [nodesRef, connectionsRef, effectiveConfig, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId,
        setDialogNodeId, message, emptyPromptMessage]);
}
