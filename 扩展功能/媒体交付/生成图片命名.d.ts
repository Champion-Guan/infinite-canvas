import type { CanvasNodeData } from "@/types/canvas";
export function generatedImageName(node: CanvasNodeData, imageId?: string): string;
export function numberGeneratedImages(nodes: CanvasNodeData[], sourceBase: (node: CanvasNodeData) => string): CanvasNodeData[];
