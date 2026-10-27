import type { Workbook } from "../Excel/Excel产品归属";
import type { ProductExcelContext } from "./Excel卡片上下文";
import { excelPromptSource, excelPromptSourceRevision, type ExcelSourcePreference } from "./Excel提示词来源";

type Preferences = Readonly<Record<string, ExcelSourcePreference>>;
export const excelWorkbookSourceKey = (workbookId: string) => `workbook:${workbookId}`;
const workbookUpdatedAt = (book: Workbook) => book.updatedAt || book.source.importedAt || "";
const workbookContext = (book: Workbook): ProductExcelContext => ({
  productId: excelWorkbookSourceKey(book.id), fileName: book.source.fileName,
  activeProductName: "", templates: book.source.promptTemplates,
});

// 设置按工作簿汇总，直接派生已有模板；不写入来源副本，不依赖当前路由或产品。
export function excelWorkbookPromptSource(book: Workbook, preference?: ExcelSourcePreference) {
  const result = excelPromptSource(workbookContext(book), workbookUpdatedAt(book), preference);
  if (!result) return null;
  return { ...result, workbookId: book.id, preferenceKey: excelWorkbookSourceKey(book.id), fileName: book.source.fileName,
    items: result.items.map(({ productId: _productId, ...item }) => ({ ...item, id: `${result.source.id}:${item.id}` })) };
}

export function excelWorkbookPromptSources(books: readonly Workbook[], preferences: Preferences) {
  return books.flatMap(book => {
    const source = excelWorkbookPromptSource(book, preferences[excelWorkbookSourceKey(book.id)]);
    return source ? [source] : [];
  });
}

// 工作簿级开关/名称作用于所属产品；模板内容、拖放产品ID仍严格取当前产品。
// 旧产品偏好继续保留；工作簿删除版本与产品删除版本分别判断，不能互相覆盖。
export function excelProductPromptSource(context: ProductExcelContext, book: Workbook | undefined, preferences: Preferences) {
  const productPreference = preferences[context.productId];
  const workbookPreference = book ? preferences[excelWorkbookSourceKey(book.id)] : undefined;
  const updatedAt = book ? workbookUpdatedAt(book) : "";
  if (book && workbookPreference?.removedRevision === excelPromptSourceRevision(workbookContext(book), updatedAt)) return null;
  return excelPromptSource(context, updatedAt, { ...productPreference, ...workbookPreference, removedRevision: productPreference?.removedRevision });
}
