import { useId, useRef, useState } from "react";
import { useProductNavigation } from "../产品/产品操作";
import { LegacyProductDialog, ProductTrashIcon } from "../产品/产品回收面板";

// 保留旧openExcelDeleteDialog的工作簿文案、布局与SVG；只适配统一保存出口。
export function WorkbookDeleteDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { deleteWorkbook, operationBusy, pendingWorkbookDeletion } = useProductNavigation();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false), title = useId();
  const pending = pendingWorkbookDeletion === id, locked = operationBusy || submitting;
  async function submit(retry = false) {
    if (inFlight.current || operationBusy) return;
    inFlight.current = true; setSubmitting(true); setError("");
    try { await deleteWorkbook(id, retry); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { inFlight.current = false; setSubmitting(false); }
  }
  return <LegacyProductDialog title="删除 Excel？" busy={locked || pending} onClose={onClose}>
    <section className="guan-dc-confirm-card" style={{ fontFamily: "ui-sans-serif, -apple-system, \"system-ui\", \"Segoe UI\", sans-serif", WebkitFontSmoothing: "antialiased", fontSize: 16, lineHeight: "24px", color: "var(--dc-text)" }} role="document" aria-labelledby={title}>
      <div className="guan-dc-confirm-icon" aria-hidden="true"><ProductTrashIcon /></div>
      <div className="guan-dc-confirm-copy">
        <h2 id={title} style={{ fontWeight: 400 }}>删除 Excel？</h2>
        <p>确定删除“<strong>{name}</strong>”吗？关联的产品、任务和素材记录也会从本地数据中删除。</p>
        <p className="guan-product-file-note">此操作不是移入产品回收站。已生成的图片、视频等文件不会在本次删除中清理。</p>
        {error ? <p role="alert">{error} 保存未确认时请勿刷新或关闭工作台。</p> : null}
      </div>
      <div className="guan-dc-confirm-actions">
        <button type="button" style={{ font: "inherit" }} disabled={locked || pending} onClick={onClose}>取消</button>
        {error || pending ? <button type="button" style={{ font: "inherit" }} disabled={locked} onClick={() => void submit(true)}>重试保存后继续</button> : null}
        <button type="button" style={{ font: "inherit" }} className="danger" disabled={locked || pending} onClick={() => void submit()}>删除</button>
      </div>
    </section>
  </LegacyProductDialog>;
}
