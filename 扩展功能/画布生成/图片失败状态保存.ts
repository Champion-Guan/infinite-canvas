import type { CanvasNodeData } from "@/types/canvas";
import { saveProductCanvas } from "../产品/产品操作";

// 失败和停止也必须经过真实提交票据；保存失败只提示恢复保存，不重新生成。
export async function saveFailedImageState(projectId: string, nodes: readonly CanvasNodeData[], ids: readonly string[],
    notify: (message: string) => void) {
    if (!nodes.some(node => ids.includes(node.id) && node.type === "image" &&
        (node.metadata?.status === "error" || node.metadata?.images?.some(image => image.status === "error")))) return;
    try { await saveProductCanvas(projectId); }
    catch { notify("图片失败状态保存尚未确认，请保留当前页面并重试保存。"); }
}
