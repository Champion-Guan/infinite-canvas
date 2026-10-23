// 旧解析函数原文提取；只将全局XLSX改为工厂形参，不安装旧DOM/存储桥。
export function createExcelParser(XLSX) {
const MAX_IMPORT_ROWS = 10000, MAX_IMPORT_COLUMNS = 200;
function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_\-（）()【】[\]：:]/g, "");
}

function cellValueForImport(cell) {
  if (!cell) return null;
  let value = cell.v;
  if (value === undefined && cell.f) value = `=${cell.f}`;
  if (cell.t === "e") value = cell.w || String(value ?? "Excel 错误值");
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string" || typeof value === "boolean") return value;
  return String(value);
}

function sheetNameLooksLikePrompt(name) {
  const normalized = normalizeHeader(name);
  return normalized.includes("视觉内容与ai提示词")
    || normalized.includes("提示词")
    || normalized.includes("prompt")
    || normalized.includes("visualcontent");
}

function valueAt(worksheet, rowIndex, columnIndex) {
  return cellValueForImport(worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })]);
}

function rowValues(worksheet, range, rowIndex) {
  const values = [];
  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    values.push(valueAt(worksheet, rowIndex, columnIndex));
  }
  return values;
}

function rowText(values) {
  return values
    .filter((value) => value !== null && String(value).trim() !== "")
    .map((value) => String(value).trim())
    .join(" | ");
}

function promptColumnLabel(value) {
  const text = String(value ?? "").trim();
  // Prompt headers in the client workbooks include dimensions after a pipe,
  // for example "Detail Prompt 01 | 900 x 1200 | 3:4". Strip that suffix
  // before extracting the prompt number so "01 | 900" is not read as 1900.
  const headerPart = text.split("|", 1)[0].trim();
  const normalized = normalizeHeader(headerPart);
  if (normalized.includes("mainprompt")) return "Main Prompt";
  const detail = normalized.match(/^detailprompt0*(\d{1,2})$/);
  if (detail) return `Detail Prompt ${String(Number(detail[1])).padStart(2, "0")}`;
  const rich = normalized.match(/^richprompt0*(\d{1,2})$/);
  if (rich) return `Rich Prompt ${String(Number(rich[1])).padStart(2, "0")}`;
  if (normalized === "videoprompt" || normalized.startsWith("videoprompt")) return "Video Prompt";
  return "";
}

function findPromptSectionRow(worksheet, range) {
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const text = rowText(rowValues(worksheet, range, rowIndex)).toLowerCase();
    if (text.includes("final english prompts") || text.includes("最终英文提示词")) return rowIndex;
  }
  return -1;
}

function parsePromptSheet(workbook, sheetName) {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet?.["!ref"]) throw new Error(`提示词工作表「${sheetName}」没有可读取的单元格`);
  const range = XLSX.utils.decode_range(worksheet["!ref"]);
  const columnCount = range.e.c - range.s.c + 1;
  if (columnCount > MAX_IMPORT_COLUMNS) throw new Error(`工作表共有 ${columnCount} 列，当前最多支持 ${MAX_IMPORT_COLUMNS} 列。请先精简工作表后再导入。`);

  const sectionRowIndex = findPromptSectionRow(worksheet, range);
  const searchStart = sectionRowIndex >= 0 ? sectionRowIndex + 1 : range.s.r;
  let headerRowIndex = -1;
  let promptDescriptors = [];
  let orderColumnIndex = -1;
  let routeColumnIndex = -1;
  for (let rowIndex = searchStart; rowIndex <= range.e.r; rowIndex += 1) {
    const values = rowValues(worksheet, range, rowIndex);
    const descriptors = [];
    values.forEach((value, offset) => {
      const label = promptColumnLabel(value);
      if (label) descriptors.push({ label, columnIndex: range.s.c + offset, originalHeader: String(value).trim() });
    });
    if (!descriptors.length) continue;
    const normalizedValues = values.map((value) => normalizeHeader(value));
    const candidateOrder = normalizedValues.findIndex((value) => value === "order" || value === "序号");
    const candidateRoute = normalizedValues.findIndex((value) => value.includes("productroute") || value.includes("产品路线"));
    // A prompt sheet must expose a real prompt matrix. A lone "Order" or
    // route column is common in documentation sections and is not enough to
    // classify the sheet as importable prompt data.
    if (descriptors.length >= 2 && (candidateOrder >= 0 || candidateRoute >= 0)) {
      headerRowIndex = rowIndex;
      promptDescriptors = descriptors;
      orderColumnIndex = candidateOrder >= 0 ? range.s.c + candidateOrder : -1;
      routeColumnIndex = candidateRoute >= 0 ? range.s.c + candidateRoute : -1;
      break;
    }
  }
  if (headerRowIndex < 0 || !promptDescriptors.length) {
    throw new Error(`工作表「${sheetName}」未找到“最终英文提示词”区域或 Prompt 表头`);
  }

  const seenLabels = new Set();
  promptDescriptors = promptDescriptors.filter((descriptor) => {
    if (seenLabels.has(descriptor.label)) return false;
    seenLabels.add(descriptor.label);
    return true;
  });
  const columns = [];
  if (orderColumnIndex >= 0) columns.push({ key: "Order", label: "Order", columnIndex: orderColumnIndex });
  if (routeColumnIndex >= 0) {
    columns.push({
      key: "Product route / core advantage",
      label: "Product route / core advantage",
      columnIndex: routeColumnIndex,
    });
  }
  promptDescriptors.forEach((descriptor) => columns.push({
    key: descriptor.label,
    label: descriptor.label,
    columnIndex: descriptor.columnIndex,
    originalHeader: descriptor.originalHeader,
  }));

  const headers = columns.map((column) => column.key);
  const headerMap = Object.fromEntries(columns.map((column) => [column.key, column.originalHeader || column.label]));
  const lastRowIndex = Math.min(range.e.r, headerRowIndex + MAX_IMPORT_ROWS);
  if (range.e.r - headerRowIndex > MAX_IMPORT_ROWS) {
    throw new Error(`工作表超过 ${MAX_IMPORT_ROWS} 个数据行。请先拆分工作表后再导入，避免浏览器存储和预览过载。`);
  }
  const rows = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex <= lastRowIndex; rowIndex += 1) {
    const values = {};
    let hasPrompt = false;
    columns.forEach((column) => {
      const value = valueAt(worksheet, rowIndex, column.columnIndex);
      values[column.key] = value;
      if (promptColumnLabel(column.label) && value !== null && String(value).trim() !== "") hasPrompt = true;
    });
    const orderValue = values.Order;
    const orderNumber = Number(orderValue);
    const hasNumericOrder = orderValue !== null
      && String(orderValue).trim() !== ""
      && Number.isInteger(orderNumber)
      && orderNumber > 0;
    // A prompt sheet also contains a validation section after the product
    // matrix. Some workbook copies repeat the section guidance across every
    // prompt column, so checking only for non-empty prompt cells would import
    // those guidance rows as products. A real product row has a positive
    // integer Order and at least one actual prompt field.
    if (hasNumericOrder && hasPrompt) rows.push({ sourceRowNumber: rowIndex + 1, values });
  }
  return {
    kind: "prompt-template",
    headers,
    headerMap,
    rows,
    headerRowNumber: headerRowIndex + 1,
    sectionRowNumber: sectionRowIndex >= 0 ? sectionRowIndex + 1 : null,
    promptColumns: promptDescriptors.map((descriptor) => descriptor.label),
    promptColumnCount: promptDescriptors.length,
  };
}

function findPromptSheetCandidate(workbook, sheetNames, excludedSheetName = "") {
  const candidates = [...sheetNames]
    .reverse()
    .filter((name) => name !== excludedSheetName && workbook.Sheets[name]?.["!ref"]);
  const prioritized = [
    ...candidates.filter((name) => sheetNameLooksLikePrompt(name)),
    ...candidates.filter((name) => !sheetNameLooksLikePrompt(name)),
  ];
  for (const sheetName of prioritized) {
    try {
      return { sheetName, parsed: parsePromptSheet(workbook, sheetName) };
    } catch {
      // A normal analysis sheet can contain a few words such as “prompt”.
      // Keep scanning until a real prompt matrix is found.
    }
  }
  return null;
}

function promptTemplatesFromParsed(parsed) {
  if (!parsed || parsed.kind !== "prompt-template") return [];
  return parsed.rows.map((row, index) => {
    const values = row.values || {};
    const prompts = {};
    for (const label of parsed.promptColumns || []) {
      const value = values[label];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        prompts[label] = String(value).trim();
      }
    }
    return {
      id: `excel-prompt-${Number(values.Order) || index + 1}`,
      order: Number(values.Order) || index + 1,
      route: String(values["Product route / core advantage"] || "").trim(),
      prompts,
      sourceRowNumber: row.sourceRowNumber,
    };
  }).filter((template) => Object.keys(template.prompts).length > 0);
}

return { parsePromptSheet, findPromptSheetCandidate, promptTemplatesFromParsed, promptColumnLabel };
}
export function parsePromptWorkbook(XLSX, workbook) {
  const sheetNames = [...workbook.SheetNames];
  if (!sheetNames.length) throw new Error("文件中没有工作表");
  const { findPromptSheetCandidate, promptTemplatesFromParsed } = createExcelParser(XLSX);
  const candidate = findPromptSheetCandidate(workbook, sheetNames);
  if (!candidate) throw new Error("未找到可识别的提示词工作表。Data 和前面的分析工作表只作为竞品参考，不能作为待生成商品导入。");
  const promptTemplates = promptTemplatesFromParsed(candidate.parsed);
  if (!promptTemplates.length) throw new Error(`工作表「${candidate.sheetName}」没有识别到可导入的提示词产品行。请确认一行对应一个产品，并包含 Main Prompt、Detail Prompt 或 Rich Prompt 列。`);
  return { ...candidate, promptTemplates };
}
