// 仅处理提示词参数识别与配置卡片快照；不执行生成或修改画布。
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasConnection } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import { getGenerationCount } from "@/lib/canvas/canvas-generation-helpers";
import { promptGenerationMode } from "../安全与批量/prompt-generation-mode";

export function promptGenerationPatch(prompt: string): CanvasNodeMetadata {
    const size = prompt.match(/\b(\d{3,5})\s*[x×]\s*(\d{3,5})\s*px\b/i);
    const ratio = prompt.match(/\b(\d+\s*:\s*\d+)\b/);
    const imageType = prompt.match(/\b(MAIN IMAGE|DETAIL IMAGE|RICH[- ]CONTENT IMAGE|VIDEO FRAME)\b/i)?.[1] || "";
    const normalizedRatio = ratio?.[1]?.replace(/\s+/g, "");
    const pixelSize = size ? `${size[1]}x${size[2]}` : undefined;
    return {
        ...(pixelSize || normalizedRatio ? { size: pixelSize || normalizedRatio } : {}),
        ...(normalizedRatio ? { generationAspectRatio: normalizedRatio } : {}),
        ...(size ? { generationPixelWidth: Number(size[1]), generationPixelHeight: Number(size[2]) } : {}),
        ...(imageType ? { generationImageType: imageType.toLowerCase() } : {}),
        ...(normalizedRatio || size || imageType ? { generationParamsDetected: true } : {}),
    };
}

export function detectedPromptConfig(source: CanvasNodeData, all: CanvasNodeData[], connections: CanvasConnection[], config: AiConfig): CanvasNodeMetadata {
    const mode = promptGenerationMode(source, all, connections) || "image";
    return {
        model: config.imageModel || config.model, size: config.size,
        count: getGenerationCount(config.canvasImageCount || config.count),
        ...promptGenerationPatch(String(source.metadata?.content || source.metadata?.prompt || "")),
        ...generationSettingsFromNode(source), generationMode: mode,
        ...(mode !== "image" ? { model: mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel } : {}),
        generationParamsSourceNodeId: source.id,
    };
}

// 连接已有提示词和配置卡时，只应用被识别的参数；未识别则保留配置卡现值。
export function applyConnectedPromptConfig(nodes: CanvasNodeData[], connections: CanvasConnection[], fromNodeId: string, toNodeId: string, config: AiConfig) {
    const pair = nodes.filter(node => node.id === fromNodeId || node.id === toNodeId);
    const promptNode = pair.find(node => node.type === CanvasNodeType.Text);
    const configNode = pair.find(node => node.type === CanvasNodeType.Config);
    if (!promptNode || !configNode) return nodes;
    const patch = promptGenerationPatch((promptNode.metadata?.content || promptNode.metadata?.prompt || "").trim());
    const mode = promptGenerationMode(promptNode, nodes, connections);
    if (mode) {
        patch.generationMode = mode;
        if (mode !== (configNode.metadata?.generationMode || "image")) {
            patch.model = mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : mode === "text" ? config.textModel : config.imageModel;
        }
    }
    if (!mode && !patch.generationParamsDetected) return nodes;
    return nodes.map(node => node.id === configNode.id
        ? { ...node, metadata: { ...node.metadata, ...patch, generationParamsSourceNodeId: promptNode.id } } : node);
}

const INHERITED_GENERATION_SETTINGS = ["model", "quality", "moderation", "size", "background", "count", "reasoningEffort", "seconds", "vquality", "generateAudio", "watermark", "videoMode", "audioVoice", "audioFormat", "audioSpeed", "audioInstructions", "generationAspectRatio", "generationPixelWidth", "generationPixelHeight", "generationImageType", "generationParamsDetected", "generationParamsSourceNodeId"] as const;

export function generationSettingsFromNode(node: CanvasNodeData | undefined) {
    if (!node) return {};
    return Object.fromEntries(INHERITED_GENERATION_SETTINGS.flatMap((key) => {
        const value = node.metadata?.[key];
        return value === undefined || value === null || value === "" ? [] : [[key, value]];
    }));
}

function generationNodeWithConnectedSettings(node: CanvasNodeData | null | undefined, nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData | undefined {
    if (!node) return undefined;
    const upstream = connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodes.find((candidate) => candidate.id === connection.fromNodeId))
        .filter((candidate): candidate is CanvasNodeData => Boolean(candidate));
    if (!upstream.length) return node;
    const inherited = upstream.reduce<Record<string, unknown>>((result, candidate) => ({ ...result, ...generationSettingsFromNode(candidate) }), {});
    return Object.keys(inherited).length ? { ...node, metadata: { ...node.metadata, ...inherited } } : node;
}

// A generation-config card is a snapshot of its settings. Once it exists,
// executing or retrying it must not re-read settings from connected prompt
// cards; only prompt text/references remain connected inputs.
export function generationNodeForExecution(node: CanvasNodeData | null | undefined, nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData | undefined {
    if (node?.type === CanvasNodeType.Config) return node;
    return generationNodeWithConnectedSettings(node, nodeId, nodes, connections);
}

