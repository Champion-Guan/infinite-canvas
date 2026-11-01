import type { CanvasNodeData } from "@/types/canvas";

export type HistoryMediaInfo = {
    channel: string;
    channelId: string;
    transport: string;
    model: string;
    dimensions: string;
    bytes: number;
    format: string;
};

export function historyMediaInfo(node: CanvasNodeData, channels?: Array<{ id: string; name: string }>): HistoryMediaInfo;
