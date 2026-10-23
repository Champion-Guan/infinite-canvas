import type { CanvasNodeData } from "@/types/canvas";
import type { FailedTaskTarget } from "./任务摘要";
export type HistoryRetryTarget = FailedTaskTarget & { unavailableStorageKey?: string };
export function runHistoryRetries(targets: HistoryRetryTarget[], options: {
    getNode: (id: string) => CanvasNodeData | undefined;
    isActive: () => boolean;
    onRetry: (node: CanvasNodeData, imageId?: string) => void | Promise<void>;
    onError: (error: unknown) => void;
}): Promise<void>;
