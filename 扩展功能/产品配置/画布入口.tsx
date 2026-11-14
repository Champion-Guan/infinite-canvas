import { useLayoutEffect, useSyncExternalStore } from "react";
import { Navigate, useMatch } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { App } from "antd";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { sqlitePreferences, storageStatus } from "../本机存储/上游浏览器存储桥";
import { ACTIVE_PRODUCT_KEY, useProductNavigation } from "../产品/产品操作";
import { navigationEntry } from "../产品/产品导航范围";
import { productRestoreMountGate } from "../产品/产品恢复挂载门禁";
import { WorkbenchHome } from "../首页/工作台首页";
import { finishStartupScreen } from "../本机存储/启动画面交接.mjs";

const subscribeStorageStatus = (listener: () => void) => {
  window.addEventListener("guan:storage-status", listener);
  return () => window.removeEventListener("guan:storage-status", listener);
};
const storageSaved = () => storageStatus().state === "saved";

export function CanvasEntry() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { createProduct, importProduct, busy } = useProductNavigation();
  const hydrated = useCanvasStore(state => state.hydrated);
  const id = useCanvasStore(state => navigationEntry(state, sqlitePreferences.getItem(ACTIVE_PRODUCT_KEY)));
  const routeId = useMatch("/canvas/:id")?.params.id;
  const removedRouteProduct = useCanvasStore(state => Boolean(routeId && !state.projects.some(project => project.id === routeId) && state.deletedProjects.some(entry => entry.id === routeId && entry.project)));
  const saved = useSyncExternalStore(subscribeStorageStatus, storageSaved, () => false);
  const theme = useThemeStore(state => state.theme);
  const deletionSaved = removedRouteProduct && saved;
  const navigating = hydrated && id && !busy && (!removedRouteProduct || deletionSaved) && !productRestoreMountGate.getSnapshot().includes(id);
  useLayoutEffect(() => {
    if (hydrated && !navigating) finishStartupScreen();
  }, [hydrated, navigating]);
  const importProductFile = async (file: File) => {
    try {
      const ids = await importProduct(file);
      message.success(ids.length === 1 ? "已新建产品并导入画布内容" : `已新建 ${ids.length} 个产品并导入画布内容`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导入产品失败");
    }
  };
  if (!hydrated) return <main className="grid h-full place-items-center bg-background text-foreground" role="status">{t("canvas.opening")}</main>;
  // 创建事务完成前不能因新产品已入内存而抢先挂载画布；持久化成功后由统一出口导航。
  // 删除或后续导航保存未确认时，不由缺失路由的兜底入口抢先导航。
  if (navigating) return <Navigate to={"/canvas/" + encodeURIComponent(id)} replace />;
  if (removedRouteProduct) {
    if (!busy && deletionSaved && !id) return <Navigate to="/" replace />;
    return <main className="grid h-full place-items-center bg-background text-foreground" role="status">
      {busy ? "正在保存删除并切换画布…" : "画布删除保存尚未确认，请在删除窗口或保存状态栏重试。"}
    </main>;
  }
  return <WorkbenchHome theme={theme} busy={busy} onImportProduct={(file) => { void importProductFile(file); }} onCreate={() => { void createProduct().catch(error => message.error(error instanceof Error ? error.message : String(error))); }} />;
}
