import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { productExcelContext } from "./Excel卡片上下文";
import { excelProductPromptSource, excelWorkbookPromptSources } from "./Excel工作簿来源";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";

const ProductIdContext = createContext<string | null>(null);
export function ExcelCanvasScope({ productId, children }: { productId: string; children: ReactNode }) {
  return <ProductIdContext.Provider value={productId}>{children}</ProductIdContext.Provider>;
}
export function useExcelProductId() {
  const id = useContext(ProductIdContext);
  if (!id) throw new Error("参数卡片未挂载到产品作用域，停止访问存储。");
  return id;
}
export function useExcelPromptContext(productId: string) {
  const books = useCanvasStore(state => state.guanWorkbooks);
  const owner = useCanvasStore(state => state.projects.find(item => item.id === productId)?.productSetId);
  const title = useCanvasStore(state => state.projects.find(item => item.id === productId)?.title);
  // 不订阅nodes、viewport、当前路由或全局activeProduct；平移、缩放、拖动不重建Excel上下文。
  return useMemo(() => productExcelContext({ projects: title === undefined ? [] : [{ id: productId, title, productSetId: owner }], guanWorkbooks: books }, productId), [books, productId, owner, title]);
}

export function useExcelPromptSource(productId: string) {
  const context = useExcelPromptContext(productId);
  const book = useCanvasStore(state => {
    const owner = state.projects.find(item => item.id === productId)?.productSetId;
    return state.guanWorkbooks?.contract.productSets.find(item => item.id === owner);
  });
  const preferences = usePromptSourceStore(state => state.excelSources);
  return useMemo(() => excelProductPromptSource(context, book, preferences), [context, book, preferences]);
}

export function useExcelWorkbookSources() {
  const books = useCanvasStore(state => state.guanWorkbooks?.contract.productSets);
  const preferences = usePromptSourceStore(state => state.excelSources);
  return useMemo(() => excelWorkbookPromptSources(books ?? [], preferences), [books, preferences]);
}
