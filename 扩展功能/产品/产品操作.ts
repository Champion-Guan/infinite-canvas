import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { readCanvasExport } from "../画布导入/画布导入";
import { flushSQLiteStorage, sqlitePreferences, retrySQLiteStorage } from "../本机存储/上游浏览器存储桥";
import { ProductOperationGate, ProductSaveRegistry } from "./产品规则";
import { ProductCommitCheckpoint } from "./产品保存检查点";
import { planProductRecycle, planProductRestore, recycledProducts } from "./产品回收规则";
import { orderedProducts } from "./产品规则";
import { planWorkbookDeletion, workbookDeletionIds } from "../Excel删除/工作簿删除规则";
import { workbookDeletionGate } from "../Excel删除/工作簿删除门禁";
import { commitWorkbookChange } from "../Excel/Excel保存导航";
import { visibleWorkbookId, withVisibleSelection, planExcelImport, rememberWorkbookProduct, selectWorkbook as planWorkbookSelection, workbookEntry, workbookProjects, type ExcelImportInput, type WorkbookSnapshot } from "../Excel/Excel产品归属";
import { productRestoreMountGate } from "./产品恢复挂载门禁";
import { commitLegacyTransfer, finishLegacyTransfer, type LegacyTransfer } from "../整批迁移/整批迁移操作";

export const ACTIVE_PRODUCT_KEY = "guan-products:active:v1";
const operations = new ProductOperationGate();
const saves = new ProductSaveRegistry();
// 结果保存复用原产品真实layout-effect提交票据，不根据当前激活路由选择画布。
export async function saveProductCanvas(id: string) {
  if (!useCanvasStore.getState().openProject(id)) throw new Error("原产品不存在，结果仍保留在任务账本。");
  await saves.flush(id);
  await flushSQLiteStorage();
}
const deletionGuards = new Map<string, () => boolean>();

export function useProductCanvasSave<T>(
  projectId: string,
  snapshot: T,
  ready: () => boolean,
  persist: (snapshot: T) => Promise<void>,
  canDelete: () => boolean = () => true,
) {
  const [ticket, requestRender] = useState(0);
  const checkpointRef = useRef<ProductCommitCheckpoint<T> | null>(null);
  if (!checkpointRef.current)
    checkpointRef.current = new ProductCommitCheckpoint(requestRender);
  const checkpoint = checkpointRef.current;
  const persistRef = useRef(persist);
  const canDeleteRef = useRef(canDelete);
  useLayoutEffect(() => {
    checkpoint.mount();
    deletionGuards.set(projectId, () => canDeleteRef.current());
    const unregister = saves.register(projectId, () =>
      checkpoint.flush((value) => persistRef.current(value)),
    );
    return () => {
      unregister();
      deletionGuards.delete(projectId);
      checkpoint.unmount();
    };
  }, [checkpoint, projectId]);
  useLayoutEffect(() => {
    persistRef.current = persist;
    canDeleteRef.current = canDelete;
    checkpoint.commit(ticket, snapshot, ready());
  });
}

export function useProductNavigation() {
  const navigate = useNavigate();
  const activeId = useMatch("/canvas/:id")?.params.id || "";
  const operationBusy = useSyncExternalStore(
    operations.subscribe,
    operations.getSnapshot,
    operations.getSnapshot,
  );
  const pendingWorkbookDeletion = useSyncExternalStore(workbookDeletionGate.subscribe, workbookDeletionGate.getSnapshot, workbookDeletionGate.getSnapshot);
  const busy = operationBusy || Boolean(pendingWorkbookDeletion);
  const commitCurrent = useCallback(async () => {
    if (workbookDeletionGate.getSnapshot()) throw new Error("工作簿删除保存尚未确认，请在原确认框重试保存后继续。");
    if (!useCanvasStore.getState().hydrated)
      throw new Error("产品数据尚未加载完成。");
    // 恢复门禁中的产品尚未挂载、不能编辑；没有页面检查点，但仍须下方全局保存ACK。
    if (activeId && !productRestoreMountGate.getSnapshot().includes(activeId)
        && useCanvasStore.getState().openProject(activeId))
      await saves.flush(activeId);
    await flushSQLiteStorage();
  }, [activeId]);
  const enter = useCallback(
    async (id: string) => {
      if (!useCanvasStore.getState().openProject(id))
        throw new Error("目标产品不存在，未切换画布。");
      const remembered = rememberWorkbookProduct(useCanvasStore.getState(), id);
      if (remembered) useCanvasStore.setState({ guanWorkbooks: remembered });
      await flushSQLiteStorage();
      const previous = sqlitePreferences.getItem(ACTIVE_PRODUCT_KEY);
      try {
        sqlitePreferences.setItem(ACTIVE_PRODUCT_KEY, id);
        await flushSQLiteStorage();
        if (!useCanvasStore.getState().openProject(id))
          throw new Error("保存期间目标产品已删除，未切换画布。");
      } catch (error) {
        // 只撤回失败的导航偏好，不删除已经创建的产品或覆盖业务数据。
        if (previous === null) sqlitePreferences.removeItem(ACTIVE_PRODUCT_KEY);
        else sqlitePreferences.setItem(ACTIVE_PRODUCT_KEY, previous);
        throw error;
      }
      navigate(`/canvas/${encodeURIComponent(id)}`, {
        replace: true,
        viewTransition: !window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches,
      });
      // 只有业务根与导航偏好均已确认，且导航已发起，才允许恢复画布挂载。
      productRestoreMountGate.release(id);
    },
    [navigate],
  );
  const selectProduct = useCallback(
    (id: string) =>
      operations.run(async () => {
        if (id === activeId) return;
        const state = useCanvasStore.getState();
        if (!workbookProjects(state.projects, visibleWorkbookId(state, activeId)).some(project => project.id === id)) throw new Error("该产品不属于当前工作表。");
        await commitCurrent();
        await enter(id);
      }),
    [activeId, commitCurrent, enter],
  );
  const importLegacyProducts = useCallback((plan: LegacyTransfer, preferLegacy: boolean, progress: (value: string) => void, preserveMissingMedia = false) =>
    operations.run(() => commitLegacyTransfer(plan, preferLegacy, commitCurrent, progress, preserveMissingMedia)), [commitCurrent]);
  const retryLegacyProducts = useCallback((keepCurrentFallback = false) => operations.run(() => finishLegacyTransfer(true, keepCurrentFallback)), []);
  const createProduct = useCallback(
    () =>
      operations.run(async () => {
        await commitCurrent();
        const current = withVisibleSelection(useCanvasStore.getState(), activeId);
        useCanvasStore.setState({ guanWorkbooks: current.guanWorkbooks });
        const id = useCanvasStore.getState().createProject();
        // 保存失败不删除新产品，不清空旧画布，也不绕过错误切换。
        await flushSQLiteStorage();
        await enter(id);
        return id;
      }),
    [activeId, commitCurrent, enter],
  );
  const importProduct = useCallback(
    (file: File) =>
      operations.run(async () => {
        await commitCurrent();
        const items = await readCanvasExport(file);
        const current = withVisibleSelection(useCanvasStore.getState(), activeId);
        useCanvasStore.setState({ guanWorkbooks: current.guanWorkbooks });
        const ids = items.map(({ project }) => {
          const id = useCanvasStore.getState().importProject(project);
          productRestoreMountGate.block(id);
          return id;
        });
        await flushSQLiteStorage();
        await enter(ids[0]);
        for (const id of ids) productRestoreMountGate.release(id);
        return ids;
      }),
    [activeId, commitCurrent, enter],
  );
  const recycleProduct = useCallback(
    (id: string) => operations.run(async () => {
      const ensureStopped = () => {
        if (deletionGuards.get(id)?.() === false)
          throw new Error("该产品有生成任务运行中，请等待任务结束后再删除。");
      };
      ensureStopped();
      await commitCurrent();
      if (id !== activeId && deletionGuards.has(id)) await saves.flush(id);
      ensureStopped();
      const before = useCanvasStore.getState();
      const planned = planProductRecycle(before, id, new Date().toISOString());
      if (planned !== before) useCanvasStore.setState(planned);
      // 失败不回滚/覆盖已确认代；完整快照仍在回收站及待确认队列，允许原UI显式重试。
      await flushSQLiteStorage();
      // 已再次归档的ID不再需要页内挂载门禁；未确认保存不走到这里。
      productRestoreMountGate.release(id);
      if (activeId === id) {
        const current = useCanvasStore.getState();
        const next = recycledProducts(current).find(entry => entry.id === id)?.nextProductId;
        const scoped = workbookProjects(current.projects, before.projects.find(project => project.id === id)?.productSetId ?? null);
        const target = scoped.find(item => item.id === next)?.id || orderedProducts(scoped)[0]?.id;
        if (target) await enter(target);
        else {
          sqlitePreferences.removeItem(ACTIVE_PRODUCT_KEY);
          await flushSQLiteStorage();
          navigate("/", { replace: true });
        }
      }
    }),
    [activeId, commitCurrent, enter, navigate],
  );
  const restoreProduct = useCallback(
    (id: string) => operations.run(async () => {
      await commitCurrent();
      const before = useCanvasStore.getState(), planned = planProductRestore(before, id);
      if (planned !== before) {
        // 必须先封住挂载，再发布恢复状态；失败时保留门禁，显式重试/切换确认后放行。
        productRestoreMountGate.block(id);
        useCanvasStore.setState(planned);
      }
      await flushSQLiteStorage();
      await enter(id);
    }),
    [commitCurrent, enter],
  );
  const finishWorkbook = useCallback(async (value: WorkbookSnapshot) => {
    const id = workbookEntry(value);
    if (id) await enter(id);
    else {
      sqlitePreferences.removeItem(ACTIVE_PRODUCT_KEY);
      await flushSQLiteStorage();
      navigate("/", { replace: true });
    }
  }, [enter, navigate]);
  const selectWorkbook = useCallback((owner: string | null) => operations.run(() => commitWorkbookChange({
    commitCurrent,
    plan: () => { const state = withVisibleSelection(useCanvasStore.getState(), activeId); return { ...state, guanWorkbooks: planWorkbookSelection(state, owner) }; },
    publish: value => useCanvasStore.setState({ guanWorkbooks: value.guanWorkbooks }),
    flush: flushSQLiteStorage, navigate: finishWorkbook,
  })), [activeId, commitCurrent, finishWorkbook]);
  const importWorkbook = useCallback((input: ExcelImportInput) => operations.run(() => commitWorkbookChange({
    commitCurrent,
    plan: () => planExcelImport(withVisibleSelection(useCanvasStore.getState(), activeId), input),
    publish: value => {
      const old = new Set(useCanvasStore.getState().projects.map(project => project.id));
      for (const project of value.projects) if (!old.has(project.id)) productRestoreMountGate.block(project.id);
      useCanvasStore.setState(value);
    },
    flush: flushSQLiteStorage, navigate: finishWorkbook,
  })), [activeId, commitCurrent, finishWorkbook]);
  const deleteWorkbook = useCallback((owner: string, retry = false) => operations.run(async () => {
    const pending = workbookDeletionGate.getSnapshot();
    if (pending && pending !== owner) throw new Error("上一次工作簿删除尚未确认，请先重试保存。");
    if (retry) await retrySQLiteStorage();
    const ensureStopped = () => {
      const state = useCanvasStore.getState();
      const ids = workbookDeletionIds(state, owner);
      for (const id of ids) if (deletionGuards.get(id)?.() === false)
        throw new Error("该工作簿有生成任务运行中，请等待任务结束后再删除。");
      planWorkbookDeletion(state, owner, activeId);
      return ids;
    };
    await workbookDeletionGate.run(owner, {
      async commitCurrent() {
        ensureStopped();
        await commitCurrent();
        for (const id of ensureStopped()) if (id !== activeId && deletionGuards.has(id)) await saves.flush(id);
        await flushSQLiteStorage();
        ensureStopped();
      },
      plan: () => planWorkbookDeletion(withVisibleSelection(useCanvasStore.getState(), activeId), owner, activeId),
      publish: value => useCanvasStore.setState(value.state),
      isPublished: () => !useCanvasStore.getState().guanWorkbooks?.contract.productSets.some(book => book.id === owner),
      flush: flushSQLiteStorage,
      async navigate(value) {
        if (value.navigate) await finishWorkbook(useCanvasStore.getState());
      },
    });
  }), [activeId, commitCurrent, finishWorkbook]);
  return { activeId, busy, operationBusy, pendingWorkbookDeletion, createProduct, importProduct, importLegacyProducts, retryLegacyProducts, selectProduct, recycleProduct, restoreProduct, selectWorkbook, importWorkbook, deleteWorkbook };
}
