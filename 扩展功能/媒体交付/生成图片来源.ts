import { numberGeneratedImages } from "./生成图片命名";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";

export function generatedImageCardTitle(promptNode?: CanvasNodeData): string {
    const sourceLabel = String(promptNode?.metadata?.excelPromptLabel || promptNode?.title || "").trim();
    if (/主图/.test(sourceLabel)) return "主图";
    const detail = sourceLabel.match(/详情页(?:提示词)?\s*0*(\d+)/i);
    if (detail) return `详情页${String(Number(detail[1])).padStart(2, "0")}`;
    const rich = sourceLabel.match(/富内容(?:提示词)?\s*0*(\d+)/i);
    if (rich) return `富内容${String(Number(rich[1])).padStart(2, "0")}`;
    if (/视频提示词/i.test(sourceLabel)) return "视频";
    return "";
}

export function findGeneratedImageSourcePrompt(node: Pick<CanvasNodeData, "id">, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData | undefined {
    const incoming = connections.filter((connection) => connection.toNodeId === node.id);
    const directPrompt = incoming
        .map((connection) => nodes.find((candidate) => candidate.id === connection.fromNodeId))
        .find((candidate) => candidate?.type === CanvasNodeType.Text);
    if (directPrompt) return directPrompt;
    const configIds = incoming
        .map((connection) => nodes.find((candidate) => candidate.id === connection.fromNodeId))
        .filter((candidate): candidate is CanvasNodeData => candidate?.type === CanvasNodeType.Config)
        .map((candidate) => candidate.id);
    return connections
        .filter((connection) => configIds.includes(connection.toNodeId))
        .map((connection) => nodes.find((candidate) => candidate.id === connection.fromNodeId))
        .find((candidate) => candidate?.type === CanvasNodeType.Text);
}

export function renameGeneratedImageNodes(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData[] {
    return numberGeneratedImages(nodes, (node: CanvasNodeData) => node.metadata?.generationType ? node.metadata.generationNameBase || generatedImageCardTitle(findGeneratedImageSourcePrompt(node, nodes, connections)) : "");
}

