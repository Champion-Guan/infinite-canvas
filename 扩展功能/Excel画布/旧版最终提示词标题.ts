import type { CanvasNodeData } from "@/types/canvas";
export function finalPromptPreviewTitle(promptNode?: CanvasNodeData): string {
    const sourceLabel = String(promptNode?.metadata?.excelPromptLabel || promptNode?.title || "").trim();
    if (/主图/.test(sourceLabel)) return "最终生成提示图 · 主图";
    const detail = sourceLabel.match(/详情页提示词\s*0*(\d+)/i);
    if (detail) return `最终生成提示图 · 详情页${String(Number(detail[1])).padStart(2, "0")}`;
    const rich = sourceLabel.match(/富内容提示词\s*0*(\d+)/i);
    if (rich) return `最终生成提示图 · 富内容${String(Number(rich[1])).padStart(2, "0")}`;
    if (/视频提示词/i.test(sourceLabel)) return "最终生成提示图 · 视频";
    return "最终生成提示图";
}
