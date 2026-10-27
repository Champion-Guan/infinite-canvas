// 旧弹窗HTML/转义/勾选更新原文；只能挂载到自有React弹窗根。
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

export function excelImportMarkup(pending) {
  const progress = Math.max(0, Math.min(100, Number(pending.progress || 0)));
  const templates = Array.isArray(pending.promptTemplates) ? pending.promptTemplates : [];
  const selected = new Set(Array.isArray(pending.selectedPromptIndexes) ? pending.selectedPromptIndexes : []);
  const selectedCount = templates.filter((_, index) => selected.has(index)).length;
  const allSelected = templates.length > 0 && selectedCount === templates.length;
  const productRows = templates.map((template, index) => {
    const title = template.route || `提示词产品 ${template.order || index + 1}`;
    const mainPrompt = template.prompts?.["Main Prompt"] || "";
    return `
      <label class="guan-dc-import-product ${selected.has(index) ? "is-selected" : ""}">
        <input type="checkbox" data-prompt-index="${index}" ${selected.has(index) ? "checked" : ""}>
        <span class="guan-dc-import-product-check" aria-hidden="true"></span>
        <span class="guan-dc-import-product-copy">
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(mainPrompt.slice(0, 160) || "已读取提示词列，可在产品面板继续补充 SKU 与规格")}${mainPrompt.length > 160 ? "…" : ""}</small>
        </span>
        <em>产品 ${index + 1}</em>
      </label>
    `;
  }).join("");
  return `
    <div class="guan-dc-excel-import-backdrop" data-excel-import-cancel></div>
    <section class="guan-dc-excel-import-card" role="document">
      <header class="guan-dc-excel-import-head">
        <div>
          <strong id="guan-dc-excel-import-title">导入提示词产品</strong>
          <span>${escapeHtml(pending.fileName || "Excel")}</span>
        </div>
        <button type="button" data-excel-import-cancel aria-label="取消上传">×</button>
      </header>
      ${pending.busy ? `
        <div class="guan-dc-excel-import-progress" aria-live="polite">
          <div class="guan-dc-excel-import-progress-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"></path></svg>
          </div>
          <strong>${escapeHtml(pending.progressMessage || "正在读取 Excel…")}</strong>
          <div class="guan-dc-excel-progress-track"><span style="width:${progress}%"></span></div>
          <small>${progress}% · 文件仅在本机浏览器中解析</small>
        </div>
      ` : pending.error ? `
        <div class="guan-dc-excel-import-error" role="alert">
          <strong>无法导入这个 Excel</strong>
          <p>${escapeHtml(pending.error)}</p>
          <button type="button" data-excel-import-cancel>关闭</button>
        </div>
      ` : `
        <div class="guan-dc-excel-import-summary">
          <strong>已读取提示词工作表「${escapeHtml(pending.sheetName || "") }」</strong>
          <span>识别到 ${templates.length} 个产品，默认全部勾选；Data 及前面的工作表仅作为竞品参考。</span>
        </div>
        <div class="guan-dc-import-select-all">
          <label><input type="checkbox" data-prompt-select-all ${allSelected ? "checked" : ""}> 全选产品</label>
          <span data-selected-count>已选择 ${selectedCount} / ${templates.length}</span>
        </div>
        <div class="guan-dc-import-products">${productRows || `<div class="guan-dc-excel-import-empty">没有找到可导入的提示词产品。</div>`}</div>
        <footer class="guan-dc-excel-import-actions">
          <button type="button" data-excel-import-cancel>取消</button>
          <button type="button" class="primary" data-excel-import-confirm ${selectedCount ? "" : "disabled"}>导入${selectedCount ? ` ${selectedCount} 个产品` : ""}</button>
        </footer>
      `}
    </section>
  `;
}

export function updateExcelImportSelection(dialog, pending) {
  const templates = Array.isArray(pending.promptTemplates) ? pending.promptTemplates : [];
  const selected = new Set(Array.isArray(pending.selectedPromptIndexes) ? pending.selectedPromptIndexes : []);
  const selectedCount = templates.filter((_, index) => selected.has(index)).length;
  const allSelected = templates.length > 0 && selectedCount === templates.length;
  const selectAll = dialog.querySelector("[data-prompt-select-all]");
  if (selectAll) {
    selectAll.checked = allSelected;
    selectAll.indeterminate = selectedCount > 0 && !allSelected;
  }
  dialog.querySelectorAll("[data-prompt-index]").forEach((input) => {
    const index = Number(input.dataset.promptIndex);
    const isSelected = selected.has(index);
    input.checked = isSelected;
    input.closest(".guan-dc-import-product")?.classList.toggle("is-selected", isSelected);
  });
  const count = dialog.querySelector("[data-selected-count]");
  if (count) count.textContent = `已选择 ${selectedCount} / ${templates.length}`;
  const confirm = dialog.querySelector("[data-excel-import-confirm]");
  if (confirm) {
    confirm.disabled = selectedCount === 0;
    confirm.textContent = selectedCount ? `导入 ${selectedCount} 个产品` : "导入";
  }
}
