import type { ExcelInsertRequest } from "./Excel卡片事务";

export const EXCEL_PROMPT_DRAG_TYPE = "application/x-guan-excel-prompt";

// 空串属于普通拖入，返回 null 交回作者的文件/文本流程；坏 Excel 数据不能降级成整批导入。
export function parseExcelPromptDrop(raw: string): ExcelInsertRequest | null {
    if (!raw) return null;
    let request: unknown;
    try { request = JSON.parse(raw); } catch { throw new Error("Excel拖入数据格式错误"); }
    if (!request || typeof request !== "object" || Array.isArray(request)
        || !("productId" in request) || typeof request.productId !== "string" || !request.productId.trim()
        || !("templateId" in request) || typeof request.templateId !== "string" || !request.templateId.trim()
        || !("key" in request) || typeof request.key !== "string" || !request.key.trim()) {
        throw new Error("Excel拖入数据格式错误");
    }
    return { productId: request.productId, templateId: request.templateId, key: request.key };
}
