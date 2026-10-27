// 旧数据合同的创建和重传函数逐字提取，存储/导航由SQLite宿主负责。
const CONTRACT_SCHEMA = "guan-workbench.v1";
const PURPOSE_ORDER = ["product-main", "product-secondary", "product-detail", "product-a-plus", "product-video", "custom"];
function timestamp() {
  return new Date().toISOString();
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEmptyState() {
  const now = timestamp();
  return {
    schema: CONTRACT_SCHEMA,
    version: 1,
    workspace: {
      id: createId("ws"),
      name: "AI 生图工作台",
      locale: "zh-CN",
      platform: "Wildberries",
      language: "ru",
      storageMode: "local-only",
      activeProductSetId: null,
      activeProductId: null,
      createdAt: now,
      updatedAt: now,
    },
    productSets: [],
    products: [],
    importRecords: [],
    slots: [],
    prompts: [],
    tasks: [],
    runs: [],
    providerAttempts: [],
    assets: [],
  };
}

function requireById(items, id, label) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`${label} 不存在：${id}`);
  return item;
}

function normalizePurpose(value) {
  return PURPOSE_ORDER.includes(value) ? value : "custom";
}

function createProductSetInternal(state, input = {}) {
  const now = timestamp();
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const set = {
    id: createId("set"),
    workspaceId: state.workspace.id,
    source: {
      kind: input.kind || "xlsx",
      fileName: String(input.fileName || "未命名产品表.xlsx"),
      fileSha256: input.fileSha256 || undefined,
      sheetName: input.sheetName || undefined,
      role: input.role || undefined,
      promptSheetName: input.promptSheetName || undefined,
      promptSelectionKey: input.promptSelectionKey || undefined,
      ...(input.headerMap && typeof input.headerMap === "object"
        ? { headerMap: clone(input.headerMap) }
        : {}),
      ...(Array.isArray(input.promptTemplates) && input.promptTemplates.length
        ? {
            promptTemplates: clone(input.promptTemplates),
            promptTemplateCount: input.promptTemplates.length,
          }
        : {}),
      slotCounts: input.slotCounts && typeof input.slotCounts === "object" ? clone(input.slotCounts) : undefined,
      importedAt: now,
    },
    productIds: [],
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  state.productSets.push(set);
  // The most recently imported workbook is the one the operator is working
  // on.  Keep the selection in the workspace so the header selector survives
  // a refresh and later product/task views can use the same active set.
  state.workspace.activeProductSetId = set.id;

  const slotTemplates = Array.isArray(input.slotTemplates) && input.slotTemplates.length
    ? input.slotTemplates
    : [{ slotId: "main-01", kind: "image", purpose: "product-main", sequence: 1, displayName: "主图 1", required: true, ratio: "1:1", resolution: "2k" }];

  rows.forEach((rowValue, index) => {
    const row = rowValue && typeof rowValue === "object" && !Array.isArray(rowValue) ? rowValue : { value: rowValue ?? "" };
    const sourceRowNumber = Number(input.sourceRowNumbers?.[index] || index + 2);
    const readField = (aliases) => {
      const entries = Object.entries(row);
      const found = entries.find(([key]) => aliases.includes(normalizeHeader(key)));
      return found?.[1];
    };
    const sku = readField(["sku", "商品编码", "货号", "skucode", "商品id", "产品id"]);
    const title = readField(["titlezh", "商品名称", "商品标题", "标题", "名称", "产品名称"]);
    const product = createProductInternal(state, {
      productSetId: set.id,
      sourceRowNumber,
      sourceRowKey: sku
        ? `${set.id}:sku:${String(sku).trim()}:row:${sourceRowNumber}`
        : `${input.fileSha256 || set.id}:row:${sourceRowNumber}`,
      headerMap: input.headerMap,
      sku: sku || undefined,
      titleZh: title || `未命名产品 ${index + 1}`,
      rawValues: row,
      order: index + 1,
      slotTemplates,
      compactImportRecord: true,
    });
    set.productIds.push(product.id);
  });
  set.status = rows.length || (Array.isArray(input.promptTemplates) && input.promptTemplates.length) ? "ready" : "draft";
  state.workspace.activeProductId = set.productIds[0] || null;
  set.updatedAt = now;
  return set;
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_\-（）()【】[\]：:]/g, "");
}

function createProductInternal(state, input = {}) {
  const productSet = requireById(state.productSets, input.productSetId, "ProductSet");
  const now = timestamp();
  const importRecordId = createId("imp");
  const sourceRowNumber = Math.max(1, Number(input.sourceRowNumber || productSet.productIds.length + 2));
  const rawValues = input.rawValues && typeof input.rawValues === "object" ? clone(input.rawValues) : {};
  state.importRecords.push({
    id: importRecordId,
    productSetId: productSet.id,
    sourceRowNumber,
    sourceRowKey: String(input.sourceRowKey || `${productSet.id}:row:${sourceRowNumber}`),
    headerMap: input.compactImportRecord ? {} : (input.headerMap && typeof input.headerMap === "object" ? clone(input.headerMap) : {}),
    // The complete row is already retained on Product.attributes. Keeping a
    // second copy here makes large real-world workbooks exceed localStorage.
    rawValues: input.compactImportRecord ? {} : rawValues,
    importedAt: now,
  });
  const product = {
    id: createId("prod"),
    workspaceId: state.workspace.id,
    productSetId: productSet.id,
    importRecordId,
    sourceRowNumber,
    order: Number(input.order || productSet.productIds.length + 1),
    identity: {
      sku: input.sku ? String(input.sku) : undefined,
      externalProductId: input.externalProductId ? String(input.externalProductId) : undefined,
      titleZh: input.titleZh ? String(input.titleZh) : undefined,
      titleRu: input.titleRu ? String(input.titleRu) : undefined,
    },
    attributes: rawValues,
    sourceAssets: Array.isArray(input.sourceAssets) ? [...input.sourceAssets] : [],
    subjectLock: {
      enabled: Boolean(input.subjectLock?.enabled),
      referenceAssetIds: Array.isArray(input.subjectLock?.referenceAssetIds) ? [...input.subjectLock.referenceAssetIds] : [],
      instruction: "preserve-product-identity",
    },
    taskGroupIds: [],
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  state.products.push(product);

  const slots = Array.isArray(input.slotTemplates) ? input.slotTemplates : [];
  for (const template of slots) {
    createSlotInternal(state, product.id, template);
  }
  product.status = slots.length ? "ready" : "draft";
  return product;
}

function createSlotInternal(state, productId, input = {}) {
  const product = requireById(state.products, productId, "Product");
  const slotId = String(input.slotId || `${input.purpose || "custom"}-${Number(input.sequence || 1)}`);
  if (state.slots.some((candidate) => candidate.productId === productId && candidate.slotId === slotId)) {
    throw new Error(`此产品已存在任务位：${slotId}`);
  }
  const now = timestamp();
  const slot = {
    id: createId("slot"),
    slotId,
    productId,
    kind: input.kind === "video" ? "video" : "image",
    purpose: normalizePurpose(input.purpose),
    sequence: Number(input.sequence || 1),
    displayName: String(input.displayName || input.slotId || "未命名任务位"),
    required: input.required !== false,
    ratio: input.ratio || "1:1",
    resolution: ["1k", "2k", "4k"].includes(input.resolution) ? input.resolution : "2k",
  };
  state.slots.push(slot);
  product.updatedAt = now;
  if (!product.taskGroupIds.length) product.taskGroupIds.push(createId("group"));
  return slot;
}

function buildSlotTemplates(counts) {
  const templates = [];
  const groups = [
    { key: "main", prefix: "main", purpose: "product-main", name: "主图", ratio: "1:1" },
    { key: "secondary", prefix: "secondary", purpose: "product-secondary", name: "副图", ratio: "3:4" },
    { key: "detail", prefix: "detail", purpose: "product-detail", name: "详情图", ratio: "3:4" },
  ];
  for (const group of groups) {
    for (let sequence = 1; sequence <= counts[group.key]; sequence += 1) {
      templates.push({
        slotId: `${group.prefix}-${String(sequence).padStart(2, "0")}`,
        kind: "image",
        purpose: group.purpose,
        sequence,
        displayName: `${group.name} ${sequence}`,
        required: true,
        ratio: group.ratio,
        resolution: "2k",
      });
    }
  }
  return templates;
}

export const createEmptyWorkbook = createEmptyState;
export function importPromptProducts(state, input = {}) {
const counts = { main: 1, secondary: 10, detail: 6 };
input = { slotCounts: counts, slotTemplates: buildSlotTemplates(counts), ...input };
const templates = Array.isArray(input.promptTemplates) ? clone(input.promptTemplates) : [];
    if (!templates.length) throw new Error("没有可导入的提示词模板");
    const productRows = Array.isArray(input.productRows) && input.productRows.length
      ? clone(input.productRows)
      : templates.map((template) => ({
          "产品名称": template.route || `提示词产品 ${template.order}`,
          "提示词路线": template.route,
          "提示词序号": template.order,
          ...template.prompts,
        }));
    const promptSelectionKey = templates
      .map((template, index) => `${template.sourceRowNumber || template.order || index + 1}:${template.id || ""}`)
      .join(",");
    const importCandidates = [...state.productSets].reverse();
    // Older versions created duplicate sets for the same filename. Prefer the
    // currently viewed version so the operator's existing canvas is updated.
    const activeIndex = importCandidates.findIndex((candidate) => candidate.id === state.workspace.activeProductSetId);
    if (activeIndex > 0) importCandidates.unshift(...importCandidates.splice(activeIndex, 1));
    const existing = importCandidates.find((candidate) => (
      candidate.source?.role === "prompt-products"
      && candidate.source?.sheetName === input.sheetName
      && ((input.fileSha256 && candidate.source?.fileSha256 === input.fileSha256
        && candidate.source?.promptSelectionKey === promptSelectionKey)
        || (input.fileName && candidate.source?.fileName === input.fileName))
    ));
    const set = existing || createProductSetInternal(state, {
      fileName: input.fileName,
      kind: input.kind,
      role: "prompt-products",
      fileSha256: input.fileSha256,
      sheetName: input.sheetName,
      promptSheetName: input.promptSheetName,
      promptSelectionKey,
      promptTemplates: templates,
      rows: productRows,
      sourceRowNumbers: input.sourceRowNumbers,
      headerMap: input.headerMap,
      slotCounts: input.slotCounts,
      slotTemplates: input.slotTemplates,
    });
    if (existing) {
      // Re-uploading a workbook updates its source, not its canvas identity.
      // Match unchanged products by route before template order (rows may move).
      const previousTemplates = existing.source.promptTemplates || [];
      const candidates = state.products.filter((product) => product.productSetId === existing.id);
      const previousProducts = previousTemplates.map((template) => candidates.find((product) => product.identity?.titleZh === template.route)
        || candidates.find((product) => product.order === previousTemplates.indexOf(template) + 1));
      const used = new Set();
      const ids = templates.map((template, index) => {
        const byRoute = previousTemplates.findIndex((old, i) => !used.has(i) && old.route === template.route);
        const byId = previousTemplates.findIndex((old, i) => !used.has(i) && old.id === template.id
          && !templates.some((incoming) => incoming.route === old.route));
        const oldIndex = byRoute >= 0 ? byRoute : byId;
        const row = productRows[index] || {};
        let product = previousProducts[oldIndex];
        if (product) {
          used.add(oldIndex);
          product.identity.titleZh = template.route || `提示词产品 ${template.order}`;
          product.attributes = clone(row);
          product.sourceRowNumber = Number(template.sourceRowNumber || index + 2);
          product.order = index + 1;
          product.updatedAt = timestamp();
        } else {
          product = createProductInternal(state, {
            productSetId: existing.id, titleZh: template.route || `提示词产品 ${template.order}`,
            rawValues: row, sourceRowNumber: template.sourceRowNumber || index + 2,
            order: index + 1, compactImportRecord: true,
            slotTemplates: input.slotTemplates || [],
          });
        }
        return product.id;
      });
      // Never delete a removed product's canvas, task history or generated assets.
      existing.productIds = [...ids, ...existing.productIds.filter((id) => !ids.includes(id))];
      existing.source.fileSha256 = input.fileSha256;
      existing.source.promptSelectionKey = promptSelectionKey;
      existing.source.importedAt = timestamp();
      existing.source.promptSheetName = input.promptSheetName || existing.source.promptSheetName;
      existing.source.promptTemplates = templates;
      existing.source.promptTemplateCount = templates.length;
      existing.updatedAt = timestamp();
      state.workspace.activeProductSetId = existing.id;
      if (!existing.productIds.includes(state.workspace.activeProductId)) state.workspace.activeProductId = existing.productIds[0] || null;
    }
    return {
      productSetId: set.id,
      productCount: set.productIds.length,
      promptTemplateCount: templates.length,
      fileName: set.source.fileName,
      promptSheetName: set.source.promptSheetName || "",
    };
}
