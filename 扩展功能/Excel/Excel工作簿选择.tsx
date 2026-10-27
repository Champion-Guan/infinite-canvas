import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useProductNavigation } from "../产品/产品操作";
import { visibleWorkbookId } from "./Excel产品归属";
import { WorkbookDeleteDialog } from "../Excel删除字体平滑/工作簿删除弹窗";
import { ExcelRecycleBinEntry } from "../Excel删除/Excel回收站面板";
import { ExcelImportPanel } from "./Excel导入面板";
import "./旧版Excel样式.css";

export function ExcelWorkbookPicker() {
  const { message } = App.useApp();
  const books = useCanvasStore(state => state.guanWorkbooks);
  const { activeId, busy, selectWorkbook } = useProductNavigation();
  const active = useCanvasStore(state => visibleWorkbookId(state, activeId));
  const hasUnbound = useCanvasStore(state => state.projects.some(project => project.productSetId === null));
  const theme = useThemeStore(state => state.theme);
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<"closed" | "opening" | "open" | "closing">("closed");
  const [file, setFile] = useState<File | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const closePanel = useCallback(() => setFile(null), []);
  const closeMenu = useCallback(() => setMenu(state => state === "closed" ? state : "closing"), []);
  useEffect(() => {
    if (menu !== "opening" && menu !== "closing") return;
    const timer = window.setTimeout(() => setMenu(menu === "opening" ? "open" : "closed"), menu === "opening" ? 190 : 170);
    return () => window.clearTimeout(timer);
  }, [menu]);
  useEffect(() => {
    if (menu === "closed") return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) closeMenu(); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", closeMenu);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("blur", closeMenu); };
  }, [menu, closeMenu]);
  const sets = [...books?.contract.productSets ?? []].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <div className="guan-excel-scope" data-theme={theme}>
    <div className="guan-dc-file-picker" ref={root} onKeyDown={event => { if (event.key === "Escape") { closeMenu(); root.current?.querySelector<HTMLButtonElement>(".guan-dc-file-trigger")?.focus(); } }}>
      <button type="button" className="guan-dc-file-trigger" aria-label="选择已上传的 Excel 文件" aria-haspopup="listbox" aria-expanded={menu === "opening" || menu === "open"}
        disabled={busy || !!file} onClick={() => setMenu(menu === "closed" || menu === "closing" ? "opening" : "closing")}>
        <span className="guan-dc-file-trigger-label">{sets.find(set => set.id === active)?.source.fileName || "暂无已上传 Excel"}</span>
        <svg className="guan-dc-file-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <div className="guan-dc-file-menu" role="listbox" aria-label="已上传的 Excel 文件" data-state={menu} hidden={menu === "closed"} inert={menu === "closing"}>
        {sets.map(set => <div key={set.id} className="guan-dc-file-option-row">
          <button type="button" className="guan-dc-file-option" role="option" aria-selected={set.id === active} disabled={busy}
            onClick={() => { closeMenu(); void selectWorkbook(set.id).catch(error => message.error(error instanceof Error ? error.message : String(error))); }}>
            <span className="guan-dc-file-option-label">{set.source.fileName}{set.source.sheetName ? ` · ${set.source.sheetName}` : ""}</span>
            {set.id === active ? <svg className="guan-dc-file-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg> : null}
          </button>
          <button type="button" className="guan-dc-file-delete" disabled={busy} aria-label={`删除 ${set.source.fileName}`} title="删除 Excel"
            onClick={event => { event.stopPropagation(); closeMenu(); setDeleting({ id: set.id, name: set.source.fileName }); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6.5 7l.8 12h9.4l.8-12M9 7l1-3h4l1 3" /></svg>
          </button>
        </div>)}
        {!sets.length ? <div className="guan-dc-file-empty">暂无已上传 Excel</div> : null}
        {sets.length > 0 && hasUnbound ? <button type="button" className="guan-dc-file-option" role="option" aria-selected={active === null} disabled={busy}
          onClick={() => { closeMenu(); void selectWorkbook(null).catch(error => message.error(error instanceof Error ? error.message : String(error))); }}>
          <span className="guan-dc-file-option-label">未关联工作簿的产品</span>
        </button> : null}
        <ExcelRecycleBinEntry disabled={busy} onOpen={closeMenu} />
        <button type="button" className="guan-dc-file-upload" aria-label="上传 Excel" disabled={busy}
          onClick={() => { setMenu("closed"); input.current?.click(); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg><span>上传 Excel</span>
        </button>
      </div>
      <input ref={input} className="guan-dc-header-file-input" type="file" accept=".xlsx,.xls,.csv" tabIndex={-1} aria-hidden="true"
        onChange={event => { const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (selected) setFile(selected); }} />
    </div>
    {file ? <ExcelImportPanel file={file} onClose={closePanel} /> : null}
    {deleting ? <WorkbookDeleteDialog id={deleting.id} name={deleting.name} onClose={() => setDeleting(null)} /> : null}
  </div>;
}
