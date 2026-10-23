import type { PromptSource } from "@/services/api/prompt-source-presets";
import { excelPromptItems, type ProductExcelContext } from "./Excel卡片上下文";

export type ExcelSourcePreference = {
  name?: string;
  homepage?: string;
  enabled?: boolean;
  removedRevision?: string;
};

// 来源只引用产品自己的工作簿，不另存模板或借用其他产品的缓存。
export function excelPromptSource(context: ProductExcelContext, updatedAt: string, preference: ExcelSourcePreference = {}) {
  if (!context.fileName) return null;
  const signature = JSON.stringify([context.fileName, context.templates]);
  let hash = 0;
  for (let index = 0; index < signature.length; index += 1) hash = (hash * 31 + signature.charCodeAt(index)) | 0;
  const revision = `${updatedAt}:${signature.length}:${hash}`;
  if (preference.removedRevision === revision) return null;
  const source: PromptSource = {
    id: `guan-excel-prompts:${context.productId}`,
    name: preference.name || `Excel提示词 · ${context.fileName.replace(/\.(xlsx|xlsm|xlsb|xls|csv)$/i, "")}`,
    url: `/canvas/__guan_excel_prompts__.json?source=${encodeURIComponent(`${context.productId}:${revision}`)}`,
    homepage: preference.homepage || "",
    enabled: preference.enabled ?? true,
    builtIn: false,
  };
  const items = excelPromptItems(context).map(item => ({ ...item, sourceId: source.id, category: source.name }));
  return { source, items, revision, lastSuccessAt: updatedAt };
}
