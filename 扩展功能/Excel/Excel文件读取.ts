import type { PromptTemplate } from "./Excel产品归属";
import { parsePromptWorkbook } from "./旧版Excel解析.js";

type Worksheet = Record<string, unknown>;
type SheetJS = { read(data: ArrayBuffer, options: Record<string, unknown>): { SheetNames: string[]; Sheets: Record<string, Worksheet> }; utils: unknown; version: string };
declare global { interface Window { XLSX?: SheetJS } }
export type ExcelPreview = {
  fileName: string; kind: string; sheetName: string; fileSha256: string; promptTemplates: PromptTemplate[];
  headerMap: Record<string, string>; selectedPromptIndexes: number[];
};
export type ExcelPending = Partial<ExcelPreview> & { busy?: boolean; error?: string; progress?: number; progressMessage?: string };
let library: Promise<SheetJS> | null = null;
export function loadLocalExcelLibrary(): Promise<SheetJS> {
  if (window.XLSX?.version === "0.18.5") return Promise.resolve(window.XLSX);
  if (!library) {
    library = new Promise<SheetJS>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/guan/Excel/xlsx.full.min.js";
      script.onload = () => window.XLSX?.version === "0.18.5" ? resolve(window.XLSX) : reject(new Error("本地 Excel 解析库没有加载。请刷新页面后重试。"));
      script.onerror = () => { script.remove(); reject(new Error("本地 Excel 解析库没有加载。请刷新页面后重试。")); };
      document.head.append(script);
    });
    library.catch(() => { library = null; });
  }
  return library;
}
export async function readExcelFile(file: File, signal: AbortSignal, progress: (value: ExcelPending) => void): Promise<ExcelPreview> {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!["xlsx", "xls", "csv"].includes(extension)) throw new Error("请选择 .xlsx、.xls 或 .csv 文件。");
  if (file.size > 100 * 1024 * 1024) throw new Error("文件超过 100 MB。请先拆分或精简文件后再导入。");
  const update = (percent: number, message: string) => { signal.throwIfAborted(); progress({ fileName: file.name, busy: true, progress: percent, progressMessage: message }); };
  update(4, "正在读取文件…");
  const [XLSX, buffer] = await Promise.all([loadLocalExcelLibrary(), file.arrayBuffer()]);
  if (buffer.byteLength > 100 * 1024 * 1024) throw new Error("文件超过 100 MB。请先拆分或精简文件后再导入。");
  update(18, "文件读取完成，正在解析工作表…");
  // 旧版选项逐字保留，CSV显式UTF-8，XLS/XLSX保留日期类型；不访问任何URL。
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, ...(extension === "csv" ? { codepage: 65001 } : {}) });
  update(42, "正在检查工作表结构…");
  const { sheetName, parsed, promptTemplates } = parsePromptWorkbook(XLSX, workbook);
  update(68, "正在识别提示词工作表中的产品…");
  update(88, "正在生成本地文件指纹…");
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  signal.throwIfAborted();
  return { fileName: file.name, kind: extension, sheetName,
    fileSha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join(""),
    headerMap: parsed.headerMap, promptTemplates, selectedPromptIndexes: promptTemplates.map((_: PromptTemplate, index: number) => index) };
}
