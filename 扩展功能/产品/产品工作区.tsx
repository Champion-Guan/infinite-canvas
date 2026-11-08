import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { activateAssetProject } from "../素材/上传资产规则";
import { Route, Routes, useMatch } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import CanvasProjectPage from "@/pages/canvas/project";
import NotFound from "@/pages/not-found/index";
import { CanvasEntry } from "../产品配置/画布入口";
import { ProductSurface } from "./产品界面边界";
import { productRestoreMountGate } from "./产品恢复挂载门禁";
import { usePreferredModelSynchronization } from "../画布生成/偏好模型同步";
import { createProductCanvasCache, retainedProductCanvases, PRODUCT_CANVAS_IDLE_TIMEOUT_MS } from "./画布缓存规则";
import { productCanvasResidency } from "./画布驻留保护";

// 最近访问的画布保留热实例；非当前画布连续安全空闲五分钟后才休眠释放。
// 后台工作实例由驻留保护临时保留，不用卸载/Activity暂停来取消用户任务。
const ProductCanvas = memo(function ProductCanvas({
  id,
  active,
  retiringProject,
  fadingOut,
  animateEntry,
  onFadeOut,
}: {
  id: string;
  active: boolean;
  retiringProject?: CanvasProject | null;
  fadingOut: boolean;
  animateEntry: boolean;
  onFadeOut: (id: string) => void;
}) {
  return (
    <ProductSurface id={id} active={active} retiringProject={retiringProject} fadingOut={fadingOut} animateEntry={animateEntry} onFadeOut={onFadeOut}>
      <Routes location={`/canvas/${encodeURIComponent(id)}`}>
        <Route path="/canvas/:id" element={<CanvasProjectPage />} />
      </Routes>
    </ProductSurface>
  );
});

export function ProductWorkspace() {
  usePreferredModelSynchronization();
  const activeId = useMatch("/canvas/:id")?.params.id || "";
  const [handoff, setHandoff] = useState({ activeId, outgoingId: "", revision: 0 });
  if (handoff.activeId !== activeId) setHandoff({ activeId, outgoingId: handoff.activeId, revision: handoff.revision + 1 });
  const finishFadeOut = useCallback((id: string) => setHandoff(current => current.outgoingId === id ? { ...current, outgoingId: "" } : current), []);
  useEffect(() => {
    if (!handoff.outgoingId) return;
    const hide = () => { if (document.visibilityState === "hidden") finishFadeOut(handoff.outgoingId); };
    hide(); document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [handoff.outgoingId, finishFadeOut]);
  useLayoutEffect(() => activateAssetProject(activeId || undefined), [activeId]);
  const home = useMatch("/");
  const blockedRestores = useSyncExternalStore(productRestoreMountGate.subscribe, productRestoreMountGate.getSnapshot, productRestoreMountGate.getSnapshot);
  const activeRestorePending = blockedRestores.includes(activeId);
  const ids = useCanvasStore(
    useShallow((state) => state.projects.map((project) => project.id)),
  );
  const [visited, setVisited] = useState<string[]>([]);
  const archivedRouteProject = useCanvasStore(state => state.deletedProjects.find(entry => entry.id === activeId)?.project ?? null);
  // 只保留已经显示过的原实例；刷新后的删除路由不能当成可编辑画布重新挂载。
  const retiringProject = activeId && !ids.includes(activeId) && visited.includes(activeId) ? archivedRouteProject : null;
  useEffect(() => {
    if (!activeId || !ids.includes(activeId)) return;
    setVisited(previous => {
      const next = retainedProductCanvases(previous, activeId, new Set(ids));
      return next.length === previous.length && next.every((id, index) => id === previous[index]) ? previous : next;
    });
  }, [activeId, ids]);
  const retained = visited.filter((id) => ids.includes(id));
  const visibleIds =
    activeId && ids.includes(activeId) && !retained.includes(activeId)
      ? [...retained, activeId]
      : retiringProject ? [...retained, activeId] : retained;
  const current = useRef({ activeId, visibleIds });
  useLayoutEffect(() => { current.current = { activeId, visibleIds }; });
  const cache = useRef<ReturnType<typeof createProductCanvasCache> | null>(null);
  useEffect(() => {
    const manager = createProductCanvasCache({
      residents: () => current.current.visibleIds, active: () => current.current.activeId,
      eligible: productCanvasResidency.eligible, prepare: id => productCanvasResidency.prepare(id),
      activity: productCanvasResidency.revision,
      // 后台保存票据检查与卸载在同一提交完成，不能被React延后重放成另一轮导航。
      release: (id, proof) => { if (proof()) flushSync(() => setVisited(previous => proof() ? previous.filter(value => value !== id) : previous)); },
      now: () => performance.now(),
      schedule: (callback, delay) => { const timer = window.setTimeout(callback, delay); return () => window.clearTimeout(timer); },
    });
    cache.current = manager;
    const unsubscribe = productCanvasResidency.subscribe(manager.request);
    const retry = () => manager.request();
    window.addEventListener("guan:storage-status", retry);
    window.addEventListener("guan:batch-save-complete", retry);
    manager.request();
    return () => {
      manager.dispose(); unsubscribe(); cache.current = null;
      window.removeEventListener("guan:storage-status", retry);
      window.removeEventListener("guan:batch-save-complete", retry);
    };
  }, []);
  useEffect(() => { cache.current?.changed(); }, [activeId, visited]);
  return (
    <div data-product-cache-idle-timeout={PRODUCT_CANVAS_IDLE_TIMEOUT_MS} data-product-cache-residents={visibleIds.length}
      style={{ position: "relative", height: "100%", minHeight: 0 }}>
      {visibleIds.filter((id) => !blockedRestores.includes(id)).map((id) => (
        <ProductCanvas key={id} id={id} active={id === activeId} retiringProject={id === activeId ? retiringProject : null}
          fadingOut={id === handoff.outgoingId} animateEntry={handoff.revision > 0} onFadeOut={finishFadeOut} />
      ))}
      {activeRestorePending ? (
        <main className="grid h-full place-items-center bg-background text-foreground" role="status">产品恢复尚未确认，请勿刷新或关闭；若保存失败，请在回收站重试。</main>
      ) : home || (activeId && !ids.includes(activeId) && !retiringProject) ? (
        <CanvasEntry />
      ) : !activeId ? (
        <NotFound />
      ) : null}
    </div>
  );
}
