import { memo, useEffect, useState, useSyncExternalStore } from "react";
import { Route, Routes, useMatch } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import CanvasProjectPage from "@/pages/canvas/project";
import NotFound from "@/pages/not-found/index";
import { CanvasEntry } from "../产品配置/画布入口";
import { ProductSurface } from "./产品界面边界";
import { productRestoreMountGate } from "./产品恢复挂载门禁";

// 原版每产品frameCache的等价边界：访问过才挂载，ID不变就不卸载；
// 保留真实尺寸、视区、选择、历史及后台任务。所有实例共用同一个Zustand/SQLite宿主，
// 不复刻旧iframe的多套浏览器数据库，不使用Activity暂停后台保存effect。
const ProductCanvas = memo(function ProductCanvas({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  return (
    <ProductSurface id={id} active={active}>
      <Routes location={`/canvas/${encodeURIComponent(id)}`}>
        <Route path="/canvas/:id" element={<CanvasProjectPage />} />
      </Routes>
    </ProductSurface>
  );
});

export function ProductWorkspace() {
  const activeId = useMatch("/canvas/:id")?.params.id || "";
  const home = useMatch("/");
  const blockedRestores = useSyncExternalStore(productRestoreMountGate.subscribe, productRestoreMountGate.getSnapshot, productRestoreMountGate.getSnapshot);
  const activeRestorePending = blockedRestores.includes(activeId);
  const ids = useCanvasStore(
    useShallow((state) => state.projects.map((project) => project.id)),
  );
  const [visited, setVisited] = useState<string[]>([]);
  useEffect(() => {
    if (!activeId || !ids.includes(activeId)) return;
    setVisited((previous) =>
      previous.includes(activeId) ? previous : [...previous, activeId],
    );
  }, [activeId, ids]);
  const retained = visited.filter((id) => ids.includes(id));
  const visibleIds =
    activeId && ids.includes(activeId) && !retained.includes(activeId)
      ? [...retained, activeId]
      : retained;
  return (
    <div style={{ position: "relative", height: "100%", minHeight: 0 }}>
      {visibleIds.filter((id) => !blockedRestores.includes(id)).map((id) => (
        <ProductCanvas key={id} id={id} active={id === activeId} />
      ))}
      {activeRestorePending ? (
        <main className="grid h-full place-items-center bg-background text-foreground" role="status">产品恢复尚未确认，请勿刷新或关闭；若保存失败，请在回收站重试。</main>
      ) : home || (activeId && !ids.includes(activeId)) ? (
        <CanvasEntry />
      ) : !activeId ? (
        <NotFound />
      ) : null}
    </div>
  );
}
