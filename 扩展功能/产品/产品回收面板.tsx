import { useId, useRef, useState, type ReactNode } from "react";
import { Modal } from "antd";
import { retrySQLiteStorage } from "../本机存储/上游浏览器存储桥";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useProductNavigation } from "./产品操作";
import { recycledProducts } from "./产品回收规则";
import { useThemeStore } from "@/stores/use-theme-store";
import styles from "./产品胶囊.module.css";

// 旧确认框/回收站的真实结构、SVG和文案迁入React；仅用现有Modal提供焦点圈与关闭清理。
export function ProductTrashIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6.5 7l.8 12h9.4l.8-12M9 7l1-3h4l1 3" /></svg>;
}

export function LegacyProductDialog({ title, busy, onClose, children }: {
  title: string; busy: boolean; onClose: () => void; children: ReactNode;
}) {
  const dark = useThemeStore((state) => state.theme === "dark");
  return <Modal open title={title} footer={null} closable={false} maskClosable={!busy}
    keyboard={!busy} onCancel={onClose} width="auto" centered transitionName="" maskTransitionName=""
    className={styles.legacyModal} styles={{ container: { padding: 0, background: "transparent", boxShadow: "none" }, mask: { background: dark ? "rgba(0,0,0,.48)" : "rgba(9,10,12,.32)", backdropFilter: "blur(8px)" } }}
    modalRender={() => <div className={styles.root}>{children}</div>}
  />;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ProductDeleteDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { recycleProduct, busy } = useProductNavigation();
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const submitting = useRef(false), title = useId();
  async function submit(retry = false) {
    if (submitting.current || busy) return;
    submitting.current = true; setError(""); setRetrying(retry);
    try {
      if (retry) await retrySQLiteStorage();
      await recycleProduct(id); onClose();
    } catch (reason) { setError(errorText(reason)); }
    finally { submitting.current = false; setRetrying(false); }
  }
  return <LegacyProductDialog title={`删除「${name}」及对应画布？`} busy={busy || retrying} onClose={onClose}>
    <section className="guan-dc-confirm-card guan-motion-panel" role="document" aria-labelledby={title}>
      <div className="guan-dc-confirm-icon" aria-hidden="true"><ProductTrashIcon /></div>
      <div className="guan-dc-confirm-copy">
        <h2 id={title}>删除「{name}」及对应画布？</h2>
        <p>产品和对应画布将移入产品回收站，可恢复。原始 Excel 和其他产品不受影响。</p>
        <p className="guan-product-file-note">已生成图片、视频等文件将保留，不会一并删除；恢复产品后可继续查看和下载。</p>
        {error ? <p role="alert">{error} 保存未确认时请勿刷新或关闭工作台。</p> : null}
      </div>
        <div className="guan-dc-confirm-actions guan-apple-stagger">
        <button type="button" className="guan-apple-action guan-apple-press" disabled={busy || retrying} onClick={onClose}>取消</button>
        {error ? <button type="button" className="guan-apple-action guan-apple-press" disabled={busy || retrying} onClick={() => void submit(true)}>重试保存后继续</button> : null}
        <button type="button" className="danger guan-apple-action guan-apple-press" disabled={busy || retrying} onClick={() => void submit()}>删除</button>
      </div>
    </section>
  </LegacyProductDialog>;
}

export function ProductTrashEntry({ variant = "icon" }: { variant?: "icon" | "text" }) {
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const { busy, restoreProduct } = useProductNavigation();
  const projects = useCanvasStore((state) => state.deletedProjects);
  const entries = recycledProducts({ projects: [], deletedProjects: projects });
  const pendingId = useRef(""), submitting = useRef(false), title = useId();
  async function restore(id: string, retry = false) {
    if (submitting.current || busy) return;
    submitting.current = true; pendingId.current = id; setError(""); setRetrying(retry);
    try {
      if (retry) await retrySQLiteStorage();
      await restoreProduct(id); pendingId.current = "";
    } catch (reason) { setError(errorText(reason)); }
    finally { submitting.current = false; setRetrying(false); }
  }
  return <>
    <button type="button" data-empty-action={variant === "text" ? "trash" : undefined} disabled={busy} title="产品回收站" aria-label="产品回收站" onClick={() => setOpen(true)}>{variant === "text" ? "产品回收站" : <ProductTrashIcon />}</button>
    {open ? <LegacyProductDialog title="产品回收站" busy={busy || retrying} onClose={() => setOpen(false)}>
      <section className="guan-dc-confirm-card guan-product-trash-card guan-motion-panel" role="document" aria-labelledby={title}>
        <h2 id={title}>产品回收站</h2>
        <p>恢复产品会同时恢复对应画布；已生成文件仍保留。</p>
        <div className="guan-product-trash-list">
          {entries.length ? entries.map((entry) => <div key={entry.id} className="guan-product-trash-row">
            <div><strong>{entry.project.title}</strong><small>{new Date(entry.deletedAt).toLocaleString()}</small></div>
            <button type="button" disabled={busy || retrying} onClick={() => void restore(entry.id)}>恢复</button>
          </div>) : <p>暂无已删除产品</p>}
        </div>
        {error ? <p role="alert">{error} 保存未确认时请勿刷新或关闭工作台。</p> : null}
        <div className="guan-dc-confirm-actions">
          {error && pendingId.current ? <button type="button" disabled={busy || retrying} onClick={() => void restore(pendingId.current, true)}>重试保存后继续</button> : null}
          <button type="button" disabled={busy || retrying} onClick={() => setOpen(false)}>关闭</button>
        </div>
      </section>
    </LegacyProductDialog> : null}
  </>;
}
