import { useId, useRef, useState } from "react";
import { retrySQLiteStorage } from "../本机存储/上游浏览器存储桥";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useProductNavigation } from "../产品/产品操作";
import { LegacyProductDialog, ProductTrashIcon } from "../产品/产品回收面板";
import { recycledWorkbookEntries } from "./Excel回收站规则";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Excel 工作簿独立回收站，不与产品回收站共享删除或恢复数据。 */
export function ExcelRecycleBinEntry({ disabled = false, onOpen }: { disabled?: boolean; onOpen?: () => void }) {
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false), [confirmId, setConfirmId] = useState("");
  const books = useCanvasStore(state => state.guanWorkbooks);
  const entries = recycledWorkbookEntries(books).slice().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const { busy, restoreWorkbook, permanentlyDeleteWorkbook } = useProductNavigation();
  const pendingId = useRef(""), pendingAction = useRef<"restore" | "delete">("restore"), submitting = useRef(false), title = useId();
  const locked = disabled || busy || retrying;
  async function restore(id: string, retry = false) {
    if (submitting.current || locked) return;
    submitting.current = true; pendingId.current = id; pendingAction.current = "restore"; setError(""); setRetrying(retry);
    try {
      if (retry) await retrySQLiteStorage();
      await restoreWorkbook(id); pendingId.current = "";
    } catch (reason) { setError(errorText(reason)); }
    finally { submitting.current = false; setRetrying(false); }
  }
  async function removePermanently(id: string, retry = false) {
    if (submitting.current || locked) return;
    submitting.current = true; pendingId.current = id; pendingAction.current = "delete"; setError(""); setRetrying(retry);
    try {
      if (retry) await retrySQLiteStorage();
      await permanentlyDeleteWorkbook(id); setConfirmId(""); pendingId.current = "";
    } catch (reason) { setError(errorText(reason)); }
    finally { submitting.current = false; setRetrying(false); }
  }
  return <>
    <button type="button" className="guan-dc-file-option guan-dc-file-recycle-entry" role="option" disabled={disabled}
      aria-label={`Excel回收站${entries.length ? `，${entries.length}项` : ""}`} onClick={() => { setError(""); onOpen?.(); setOpen(true); }}>
      <span className="guan-dc-file-option-label"><ProductTrashIcon /> Excel回收站{entries.length ? `（${entries.length}）` : ""}</span>
    </button>
    {open ? <LegacyProductDialog title="Excel回收站" busy={locked} onClose={() => setOpen(false)}>
      <section className="guan-dc-confirm-card guan-product-trash-card guan-excel-recycle-card" role="document" aria-labelledby={title}>
        <div className="guan-excel-recycle-heading"><ProductTrashIcon /><div><h2 id={title}>Excel回收站</h2><p>删除的 Excel 工作簿会保留在这里，恢复后产品、画布和任务记录会一起回来。</p></div></div>
        <div className="guan-product-trash-list">
          {entries.length ? entries.map(entry => {
            const name = entry.workbook.source.fileName || "未命名 Excel";
            const isConfirming = confirmId === entry.id;
            return <div key={entry.id} className="guan-product-trash-row guan-excel-recycle-row">
              <div><strong>{name}</strong><small>{entry.workbook.source.sheetName ? `${entry.workbook.source.sheetName} · ` : ""}{entry.products.length} 个产品 · {new Date(entry.deletedAt).toLocaleString()}</small></div>
              <div className="guan-excel-recycle-actions">
                <button type="button" disabled={locked} onClick={() => void restore(entry.id)}>恢复</button>
                {isConfirming ? <><button type="button" disabled={locked} onClick={() => void removePermanently(entry.id)}>确认永久删除</button><button type="button" disabled={locked} onClick={() => setConfirmId("")}>取消</button></>
                  : <button type="button" className="danger" disabled={locked} onClick={() => { setError(""); setConfirmId(entry.id); }}>永久删除</button>}
              </div>
            </div>;
          }) : <p>暂无已删除 Excel</p>}
        </div>
        {error ? <p role="alert">{error} 保存未确认时请勿刷新或关闭工作台。</p> : null}
        <div className="guan-dc-confirm-actions">
          {error && pendingId.current ? <button type="button" disabled={locked} onClick={() => pendingAction.current === "restore" ? void restore(pendingId.current, true) : void removePermanently(pendingId.current, true)}>重试保存后继续</button> : null}
          <button type="button" disabled={locked} onClick={() => setOpen(false)}>关闭</button>
        </div>
      </section>
    </LegacyProductDialog> : null}
  </>;
}
