import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";
export type FailedTaskTarget = { node: CanvasNodeData; imageId?: string };
export function failedTaskTargets(nodes: CanvasNodeData[], connections?: CanvasConnection[]): FailedTaskTarget[];
export function canvasTaskSummary(nodes: CanvasNodeData[], connections?: CanvasConnection[]): { status: string; taskId: string; startedAt: number };
