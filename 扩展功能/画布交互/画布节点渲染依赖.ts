import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

type ProductPromptMetadata = { parameterId?: string };

function productParameterId(node: CanvasNodeData) {
    const metadata = node.metadata as (typeof node.metadata & Record<string, unknown>) | undefined;
    const prompt = metadata?.productImagePrompt as ProductPromptMetadata | undefined;
    return typeof prompt?.parameterId === "string" ? prompt.parameterId : undefined;
}

function sameNodes(first: CanvasNodeData[] | undefined, second: CanvasNodeData[]) {
    return Boolean(first && first.length === second.length && first.every((node, index) => node === second[index]));
}

export function buildCanvasNodeRenderDependencies(
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    previous: Map<string, CanvasNodeData[]> = new Map(),
) {
    const nodesById = new Map(nodes.map(node => [node.id, node]));
    const dependencies = new Map<string, CanvasNodeData[]>();
    const add = (targetId: string, source: CanvasNodeData | undefined) => {
        if (!source) return;
        const list = dependencies.get(targetId);
        if (list) list.push(source);
        else dependencies.set(targetId, [source]);
    };

    for (const node of nodes) {
        const parameterId = productParameterId(node);
        if (parameterId) add(node.id, nodesById.get(parameterId));
    }

    for (const connection of connections) {
        const source = nodesById.get(connection.fromNodeId);
        if (!source) continue;
        add(connection.toNodeId, source);
        const parameterId = productParameterId(source);
        if (parameterId) add(connection.toNodeId, nodesById.get(parameterId));
    }

    for (const [nodeId, current] of dependencies) {
        const stable = previous.get(nodeId);
        if (sameNodes(stable, current)) dependencies.set(nodeId, stable!);
    }
    return dependencies;
}

export function reuseCanvasResourceReferences(
    previous: CanvasResourceReference[] | undefined,
    current: CanvasResourceReference[],
) {
    if (!previous || previous.length !== current.length) return current;
    const same = previous.every((item, index) => {
        const next = current[index];
        return item.id === next.id && item.nodeId === next.nodeId && item.kind === next.kind
            && item.label === next.label && item.title === next.title && item.previewUrl === next.previewUrl
            && item.text === next.text && item.active === next.active;
    });
    return same ? previous : current;
}
