import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import type { CanvasNodeData, Position } from "@/types/canvas";
import { buildPromptVariablesMetadata, PROMPT_VARIABLES_NODE_TYPE } from "./旧版参数规则";

const DEFAULT_PARAMETER_CENTER: Position = { x: 300, y: 340 };

export function createDefaultProductParameterNode(center: Position = DEFAULT_PARAMETER_CENTER): CanvasNodeData {
    return createCanvasNode(PROMPT_VARIABLES_NODE_TYPE, center, buildPromptVariablesMetadata());
}

export function ensureProductParameterNode(nodes: CanvasNodeData[]): CanvasNodeData[] {
    return nodes.some(node => node.type === PROMPT_VARIABLES_NODE_TYPE)
        ? nodes
        : [...nodes, createDefaultProductParameterNode()];
}
