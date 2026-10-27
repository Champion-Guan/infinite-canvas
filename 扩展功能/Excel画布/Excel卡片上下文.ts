import type { WorkbookSnapshot } from "../Excel/Excel产品归属";
import { parseExcelPromptSpec, type ExcelPromptContext } from "./旧版参数规则";

export type ProductExcelContext = ExcelPromptContext & { productId: string };

// 旧readTemplates的身份边界改用显式产品ID；缓存的非当前产品不能借用地址栏或全局activeProduct。
type ContextSnapshot = Pick<WorkbookSnapshot, "guanWorkbooks"> & {
  projects: ReadonlyArray<Pick<WorkbookSnapshot["projects"][number], "id" | "title" | "productSetId">>;
};
export function productExcelContext(snapshot: ContextSnapshot, productId: string): ProductExcelContext {
  const empty: ProductExcelContext = { productId, fileName: "", activeProductName: "", templates: [] };
  const canvas = snapshot.projects.find(item => item.id === productId);
  if (!canvas?.productSetId || !snapshot.guanWorkbooks) return empty;
  const contract = snapshot.guanWorkbooks.contract;
  const book = contract.productSets.find(item => item.id === canvas.productSetId);
  const product = contract.products.find(item => item.id === productId && item.productSetId === canvas.productSetId);
  if (!book || !product) return empty;
  const route = String(product.identity.titleZh || "").trim();
  const name = route.split(/[|｜]/, 1)[0].trim();
  const all = book.source.promptTemplates;
  const exact = all.filter(item => item.route.trim() === route);
  const sameRow = (items: typeof all) => items.find(item => item.sourceRowNumber != null && Number(item.sourceRowNumber) === Number(product.sourceRowNumber));
  let selected: typeof all = [];
  if (exact.length) {
    const match = sameRow(exact);
    // 重名完整路线也必须按行消歧，不能把第一行借给另一产品。
    selected = match ? [match] : exact.length === 1 ? exact : [];
  } else if (book.source.role !== "prompt-products" && name) {
    const named = all.filter(item => item.route.split(/[|｜]/, 1)[0].trim() === name);
    const match = sameRow(named);
    selected = match ? [match] : named.length === 1 ? named : [];
  }
  return { productId, fileName: book.source.fileName, activeProductName: name,
    templates: selected.map(template => ({ ...template, prompts: Object.fromEntries(Object.entries(template.prompts).filter(([, value]) => value.trim())) })) };
}

export function excelPromptItems(context: ProductExcelContext) {
  return context.templates.flatMap((template, templateIndex) => {
    const name = template.route.split(/[|｜]/, 1)[0].trim() || `提示词产品 ${templateIndex + 1}`;
    return Object.entries(template.prompts).filter(([, value]) => value.trim()).map(([key, value], index) => {
      const spec = parseExcelPromptSpec(key, value);
      // 保留旧列表的双位列名、标题和预览文案。
      const label = spec.label.replace(/(详情页提示词|富内容提示词)(\d+)$/, (_, prefix: string, number: string) => prefix + number.padStart(2, "0"));
      return { id: `guan-excel-prompts-${template.id}-${index + 1}`,
        title: `${name} · ${label}${spec.theme ? ` · ${spec.theme}` : ""}`, prompt: value,
        description: `来自 Excel · ${name}`, coverUrl: "", referenceImageUrls: [], tags: ["Excel", name, label],
        preview: [spec.theme && `主题/角度：${spec.theme}`, spec.purpose && `画面任务：${spec.purpose}`].filter(Boolean).join("\n"),
        createdAt: "", updatedAt: "", sourceUrl: "", sourceId: "guan-excel-prompts", category: "Excel 提示词", githubUrl: "",
        excelPrompt: { ...spec, templateId: template.id, label }, productId: context.productId };
    });
  });
}
export type ExcelPromptItem = ReturnType<typeof excelPromptItems>[number];
