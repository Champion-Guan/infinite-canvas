import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useThemeStore } from "@/stores/use-theme-store";
import { useProductNavigation } from "../产品/产品操作";
import { excelImportMarkup, updateExcelImportSelection } from "./旧版Excel弹窗.js";
import { readExcelFile, type ExcelPending, type ExcelPreview } from "./Excel文件读取";
import "./旧版Excel样式.css";

export function ExcelImportPanel({ file, onClose }: { file: File; onClose(): void }) {
  const theme = useThemeStore(state => state.theme);
  const { importWorkbook } = useProductNavigation();
  const [pending, setPending] = useState<ExcelPending>({ fileName: file.name, busy: true, progress: 4, progressMessage: "正在读取文件…" });
  const [closing, setClosing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selection = useRef<ExcelPreview | null>(null);
  const submitting = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const priorFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const focusToRestore = priorFocus.current;
    const controller = new AbortController(); abort.current = controller;
    void readExcelFile(file, controller.signal, setPending).then(result => {
      if (!controller.signal.aborted) { selection.current = result; setPending({ ...result, selectedPromptIndexes: [...result.selectedPromptIndexes] }); }
    }, reason => { if (!controller.signal.aborted) setPending({ fileName: file.name, error: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { controller.abort(); focusToRestore?.focus(); };
  }, [file]);
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClose, 180);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);
  useLayoutEffect(() => {
    root.current?.querySelector<HTMLButtonElement>("button[data-excel-import-cancel]")?.focus();
  }, [pending.busy, pending.error]);
  const cancel = () => { if (!submitting.current) { abort.current?.abort(); setClosing(true); } };
  const submit = async () => {
    const current = selection.current;
    if (!current || submitting.current || pending.error || pending.busy || closing) return;
    const chosen = new Set(current.selectedPromptIndexes);
    const templates = current.promptTemplates.filter((_, index) => chosen.has(index));
    if (!templates.length) return;
    submitting.current = true;
    setPending({ fileName: file.name, busy: true, progress: 100, progressMessage: "正在保存工作簿与产品…" });
    try {
      await importWorkbook({ ...current, promptSheetName: current.sheetName, promptTemplates: templates,
        sourceRowNumbers: templates.map(template => template.sourceRowNumber) });
      submitting.current = false; setClosing(true);
    } catch (reason) {
      submitting.current = false;
      // 已发布的根仍在SQLite失败队列，错误不表示“什么也没导入”。禁止重新导入制造第二份。
      setPending({ fileName: file.name, error: (reason instanceof Error ? reason.message : String(reason)) + " 若已进入保存阶段，请先使用保存状态栏重试，勿刷新或重复导入。" });
    }
  };
  return createPortal(<div className="guan-excel-scope" data-theme={theme}>
    <div ref={root} className="guan-dc-excel-import-modal" data-state={closing ? "closing" : "open"}
      role="dialog" aria-modal="true" aria-busy={pending.busy} aria-labelledby="guan-dc-excel-import-title" tabIndex={-1}
      onClick={event => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-excel-import-cancel]")) cancel();
        else if (target?.closest("[data-excel-import-confirm]")) void submit();
      }}
      onInput={event => {
        const target = event.target;
        const current = selection.current;
        if (!(target instanceof HTMLInputElement) || !current || submitting.current || pending.busy || pending.error) return;
        if (target.matches("[data-prompt-select-all]")) current.selectedPromptIndexes = target.checked ? current.promptTemplates.map((_, index) => index) : [];
        else if (target.matches("[data-prompt-index]")) {
          const index = Number(target.dataset.promptIndex), selected = new Set(current.selectedPromptIndexes);
          if (target.checked) selected.add(index); else selected.delete(index);
          current.selectedPromptIndexes = [...selected].sort((a, b) => a - b);
        }
        if (root.current) updateExcelImportSelection(root.current, current);
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.stopPropagation(); cancel(); }
        if (event.key !== "Tab" || !root.current) return;
        const focusable = [...root.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      dangerouslySetInnerHTML={{ __html: excelImportMarkup(pending) }} />
  </div>, document.body);
}
