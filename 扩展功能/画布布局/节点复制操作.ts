// 整卡复制与多选粘贴共用原节点事务；副本只复用内容，不接管原生成任务。
import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ContextMenuState, type Position } from "@/types/canvas";
import { remapCopiedExcelRelations } from "../Excel画布/Excel卡片事务";

type Clipboard = { nodes: CanvasNodeData[]; connections: CanvasConnection[] };
type Setter<T> = Dispatch<SetStateAction<T>>;
type CopyPort = {
    nodesRef: RefObject<CanvasNodeData[]>;
    connectionsRef: RefObject<CanvasConnection[]>;
    selectedNodeIdsRef: RefObject<Set<string>>;
    getCanvasCenter: () => Position;
    setNodes: Setter<CanvasNodeData[]>;
    setConnections: Setter<CanvasConnection[]>;
    setSelectedNodeIds: Setter<Set<string>>;
    setSelectedConnectionId: Setter<string | null>;
    setContextMenu: Setter<ContextMenuState | null>;
    setDialogNodeId: Setter<string | null>;
};

export function captureCopiedNodes(nodes: CanvasNodeData[], connections: CanvasConnection[], selected: Set<string>): Clipboard | null {
    const copied = nodes.filter(node => selected.has(node.id));
    if (!copied.length) return null;
    return structuredClone({ nodes: copied, connections: connections.filter(edge => selected.has(edge.toNodeId)) });
}

function copyContent(source: CanvasNodeData): CanvasNodeData {
    const node = structuredClone(source), metadata = node.metadata;
    if (!metadata) return node;
    const hadPendingVideo = Boolean(metadata.videoTaskId && !metadata.content);
    delete metadata.gatewayGenerationTasks;
    delete metadata.gatewayGenerationReceipts;
    delete metadata.gatewayThemeCalibrationInput;
    delete metadata.videoTaskId;
    delete metadata.videoTaskProvider;
    delete metadata.generationStartedAt;
    delete metadata.generationBatchId;
    if (metadata.status === "loading" || hadPendingVideo) {
        metadata.status = metadata.content ? "success" : "idle";
        metadata.errorDetails = undefined;
    }
    for (const item of [...(metadata.images || []), ...(metadata.texts || [])]) {
        if (item.status === "loading") { item.status = item.content ? "success" : "idle"; item.errorDetails = undefined; }
    }
    return node;
}

function copyRelations(node: CanvasNodeData, idMap: Map<string, string>, existingIds: Set<string>, keepGroup: boolean): CanvasNodeData {
    node = remapCopiedExcelRelations(node, idMap);
    const metadata = node.metadata;
    if (!metadata) return node;
    for (const key of ["promptVariableSourceNodeId", "promptVariablePreviewNodeId", "excelPromptBindingNodeId", "promptVariablePreviewOf", "promptVariableEnglishPreviewOf", "promptVariableTranslationOf", "generationParamsSourceNodeId", "groupId"] as const) {
        const id = metadata[key];
        if (!id) continue;
        if (idMap.has(id)) metadata[key] = idMap.get(id);
        else if (!existingIds.has(id) || (key === "groupId" && !keepGroup && ![...idMap.values()].includes(id))) metadata[key] = undefined;
    }
    if (!metadata.excelPromptBindingNodeId) metadata.excelPromptResolved = undefined;
    return node;
}

export function prepareCopiedNodes(clipboard: Clipboard, center: Position, current: CanvasNodeData[], edgeId = nanoid): Clipboard {
    if (!clipboard.nodes.length) return { nodes: [], connections: [] };
    const left = Math.min(...clipboard.nodes.map(node => node.position.x)), top = Math.min(...clipboard.nodes.map(node => node.position.y));
    const right = Math.max(...clipboard.nodes.map(node => node.position.x + node.width)), bottom = Math.max(...clipboard.nodes.map(node => node.position.y + node.height));
    const dx = center.x - (left + right) / 2, dy = center.y - (top + bottom) / 2;
    const idMap = new Map(clipboard.nodes.map(node => [node.id, edgeId()]));
    const existing = new Set([...current.map(node => node.id), ...idMap.values()]);
    const nodes = clipboard.nodes.map(source => {
        const node = copyContent(source);
        node.id = idMap.get(source.id)!;
        node.title = source.title.endsWith(" Copy") ? source.title : `${source.title} Copy`;
        node.position = { x: source.position.x + dx, y: source.position.y + dy };
        return copyRelations(node, idMap, existing, false);
    });
    const connections = clipboard.connections.flatMap(edge => {
        const toNodeId = idMap.get(edge.toNodeId), fromNodeId = idMap.get(edge.fromNodeId) ?? edge.fromNodeId;
        return toNodeId && existing.has(fromNodeId) ? [{ ...edge, id: edgeId(), fromNodeId, toNodeId }] : [];
    });
    return { nodes, connections };
}

export function useCanvasNodeCopy({ nodesRef, connectionsRef, selectedNodeIdsRef, getCanvasCenter, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setContextMenu, setDialogNodeId }: CopyPort) {
    const clipboardRef = useRef<Clipboard | null>(null);
    const appendCopy = useCallback((copy: Clipboard, closeMenu: boolean) => {
        if (!copy.nodes.length) return;
        setNodes(previous => [...previous, ...copy.nodes]);
        connectionsRef.current = [...connectionsRef.current, ...copy.connections];
        setConnections(connectionsRef.current);
        setSelectedNodeIds(new Set(copy.nodes.map(node => node.id)));
        setSelectedConnectionId(null);
        if (closeMenu) setContextMenu(null);
        setDialogNodeId(copy.nodes[0].type === CanvasNodeType.Group ? null : copy.nodes[0].id);
    }, [connectionsRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setContextMenu, setDialogNodeId]);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find(node => node.id === nodeId);
        if (!source) return;
        const node = copyContent(source);
        node.id = nanoid(); node.title = `${source.title} Copy`;
        node.position = { x: source.position.x + 36, y: source.position.y + 36 };
        const existing = new Set([...nodesRef.current.map(item => item.id), node.id]);
        const next = copyRelations(node, new Map([[source.id, node.id]]), existing, true);
        const connections = connectionsRef.current.filter(edge => edge.toNodeId === nodeId && existing.has(edge.fromNodeId))
            .map(edge => ({ ...edge, id: nanoid(), fromNodeId: edge.fromNodeId === nodeId ? node.id : edge.fromNodeId, toNodeId: node.id }));
        appendCopy({ nodes: [next], connections }, false);
    }, [nodesRef, connectionsRef, appendCopy]);

    const copySelectedNodes = useCallback(() => {
        const snapshot = captureCopiedNodes(nodesRef.current, connectionsRef.current, selectedNodeIdsRef.current);
        if (snapshot) clipboardRef.current = snapshot;
    }, [nodesRef, connectionsRef, selectedNodeIdsRef]);

    const pasteCopiedNodes = useCallback(() => {
        if (!clipboardRef.current?.nodes.length) return false;
        appendCopy(prepareCopiedNodes(clipboardRef.current, getCanvasCenter(), nodesRef.current), true);
        return true;
    }, [appendCopy, getCanvasCenter, nodesRef]);

    return { duplicateNode, copySelectedNodes, pasteCopiedNodes };
}
