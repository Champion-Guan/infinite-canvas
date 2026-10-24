import { useMemo, useState, type ReactNode } from "react";
import { BookOpen, ChevronRight } from "lucide-react";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import type { Prompt } from "@/services/api/prompts";
import { sqlitePreferences } from "../本机存储/上游浏览器存储桥";
import { useExcelProductId, useExcelPromptContext, useExcelPromptSource } from "./Excel画布上下文";
import type { ExcelPromptItem } from "./Excel卡片上下文";
import { EXCEL_PROMPT_DRAG_TYPE } from "./Excel拖入校验";
import "./Excel提示词列表.css";

export { EXCEL_PROMPT_DRAG_TYPE } from "./Excel拖入校验";
export function ExcelPromptGroup({ keyword, theme, onInsert, onView, renderRow }: {
  keyword: string; theme: CanvasTheme; onInsert: (payload: InsertAssetPayload) => void;
  onView: (item: Prompt) => void;
  renderRow: (item: ExcelPromptItem, insert: () => void, view: () => void) => ReactNode;
}) {
  const productId = useExcelProductId();
  const context = useExcelPromptContext(productId);
  const source = useExcelPromptSource(productId);
  const dark = useThemeStore(state => state.theme === "dark");
  const [open, setOpen] = useState(true);
  const [productOpen, setProductOpen] = useState(true);
  const [includeVideo, setIncludeVideo] = useState(() => sqlitePreferences.getItem("guan-excel-import-video-prompts-v2") === "true");
  const items = source?.items;
  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return query ? items?.filter(item => [item.title, item.prompt, ...item.tags].join(" ").toLowerCase().includes(query)) || [] : items || [];
  }, [items, keyword]);
  if (!source?.source.enabled || !items?.length) return null;
  const show = open || !!keyword.trim();
  return <div className="guan-excel-prompt-list" data-theme={dark ? "dark" : "light"}>
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={show} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100">
      <ChevronRight className={`size-3.5 transition-transform ${show ? "rotate-90" : ""}`} /><BookOpen className="size-3.5" />
      <span className="min-w-0 flex-1 truncate" title={source.source.name}>{source.source.name}</span>{show ? <span className="opacity-50">{filtered.length}</span> : null}
    </button>
    {show ? <div className="px-1 pb-2 pt-1">
      <div className="guan-excel-product-toolbar">
        <button type="button" className="guan-excel-product-menu" onClick={() => setProductOpen(value => !value)} aria-expanded={productOpen}>
          <span style={{ transform: productOpen ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>{context.activeProductName || "当前产品"}
        </button>
        <label className="guan-excel-video-import-toggle" title={`是否导入视频提示词：${includeVideo ? "已开启，一键导入时包含视频提示词" : "已关闭，一键导入时跳过视频提示词"}`}>
          <input type="checkbox" role="switch" aria-label="是否导入视频提示词" checked={includeVideo} onChange={event => {
            setIncludeVideo(event.target.checked);
            sqlitePreferences.setItem("guan-excel-import-video-prompts-v2", String(event.target.checked));
          }} /><span aria-hidden="true" className="guan-excel-video-track"><span /></span>
        </label>
        <button type="button" className="guan-excel-batch-import" onClick={() => onInsert({ kind: "excel-batch", productId, includeVideo })}>一键导入</button>
      </div>
      {productOpen ? <div className="space-y-1.5" style={{ color: theme.node.text }}>
        {filtered.map(item => <div key={item.id} draggable className="cursor-grab active:cursor-grabbing" data-canvas-prompt-drag data-excel-prompt-key={item.excelPrompt.key} onDragStart={event => {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(EXCEL_PROMPT_DRAG_TYPE, JSON.stringify({ productId, templateId: item.excelPrompt.templateId, key: item.excelPrompt.key }));
          event.dataTransfer.setData("text/plain", item.prompt);
        }}>{renderRow(item, () => onInsert({ kind: "text", content: item.prompt, title: item.title, excelPrompt: item.excelPrompt, excelProductId: productId }), () => onView(item))}</div>)}
        {!filtered.length ? <div className="py-4 text-center text-xs opacity-40">没有匹配的提示词</div> : null}
      </div> : null}
    </div> : null}
  </div>;
}
