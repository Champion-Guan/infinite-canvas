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
import { flushSQLiteStorage, sqlitePreferences, retrySQLiteStorage, storageStatus } from "../本机存储/上游浏览器存储桥";
import { ProductOperationGate, ProductSaveRegistry } from "./产品规则";
import { ProductCommitCheckpoint } from "./产品保存检查点";
import { planProductRecycle, planProductRestore, recycledProducts } from "./产品回收规则";
import { orderedProducts } from "./产品规则";
import { planWorkbookDeletion, workbookDeletionIds } from "../Excel删除/工作簿删除规则";
import { workbookDeletionGate } from "../Excel删除/工作簿删除门禁";
import { planWorkbookPermanentDelete, planWorkbookRestore, recycledWorkbookEntries } from "../Excel删除/Excel回收站规则";
import { commitWorkbookChange } from "../Excel/Excel保存导航";
import { visibleWorkbookId, withVisibleSelection, planExcelImport, prepareWorkbookEntry, rememberWorkbookProduct, selectWorkbook as planWorkbookSelection, workbookEntry, workbookProjects, type ExcelImportInput, type WorkbookSnapshot } from "../Excel/Excel产品归属";
import { ensureProductParameterNode } from "../Excel画布/产品参数卡片默认";
import { productRestoreMountGate } from "./产品恢复挂载门禁";
import { isBatchCanvasSaveActive, markBatchCanvasDirty, withBatchCanvasCheckpoint } from "../画布生成/批量保存协调";
import { registerUpgradeParticipant } from "../软件更新/升级页面状态.mjs";
import { productCanvasResidency } from "./画布驻留保护";

export const ACTIVE_PRODUCT_KEY = "guan-products:active:v1";
const operations = new ProductOperationGate();
const saves = new ProductSaveRegistry();
export type ProductCanvasSaveResult = { persisted: boolean; deferred: boolean };
// 结果保存复用原产品真实layout-effect提交票据，不根据当前激活路由选择画布。
export async function saveProductCanvas(id: string, options: { force?: boolean; checkpoint?: boolean } = {}): Promise<ProductCanvasSaveResult> {
  // force 只由批量收尾保存使用：门控仍保持开启，避免 React 订阅在最终
  // 快照落盘前插入第二笔保存；真正的检查点回调也会收到 forceBatch。
  // 这里记录“调用开始时是否确实处于批量收尾门控”。如果普通保存已经
  // 在批量开始前进入保存队列，即使调用者误传 force，也不能让它在批量
  // 中途完成后继续写 SQLite。
  const forceBatch = options.force === true && isBatchCanvasSaveActive(id);
  if (isBatchCanvasSaveActive(id) && !options.force) {
    markBatchCanvasDirty(id);
    // 一键执行期间只保留内存中的最新画布。视频身份和生成结果都由批量结束
    // 时的最终快照一次性提交，避免 checkpoint 绕过批量门控触发 SQLite 写入。
    return { persisted: false, deferred: true };
  }
  const commit = async (): Promise<ProductCanvasSaveResult> => {
    if (!useCanvasStore.getState().openProject(id)) throw new Error("原产品不存在，结果仍保留在任务账本。");
    // 最终检查点的持久化放行在 useProductCanvasSave 的真实 persist 边界发放。
    // 这里不能包住整个 saves.flush，否则等待 React 提交票据期间，其他
    // Zustand 更新可能抢先消费一次性放行票据。
    await saves.flush(id, { forceBatch });
    // 保存请求可能在批量开始前已经进入队列；真正准备写入 SQLite
    // 时再次检查，避免批量执行期间仍提交一次整画布。
    if (isBatchCanvasSaveActive(id) && !forceBatch) {
      markBatchCanvasDirty(id);
      return { persisted: false, deferred: true };
    }
    try {
      await flushSQLiteStorage();
    } catch (error) {
      // 批量最终快照只允许对已经进入SQLite恢复队列的保存做一次
      // 有界重试。这样瞬时连接/会话错误不会把用户留在失败状态，
      // 但也不会重新生成、重新创建任务，或掩盖React检查点错误。
      if (!options.force) throw error;
      const status = storageStatus();
      if (status.state !== "error" && !status.reconnectRequired && !status.pending)
        throw error;
      await retrySQLiteStorage();
    }
    return { persisted: true, deferred: false };
  };
  return commit();
}
const deletionGuards = new Map<string, () => boolean>();
registerUpgradeParticipant("products", {
  ready: () => !operations.getSnapshot() && !workbookDeletionGate.getSnapshot()
    && [...deletionGuards].every(([id, idle]) => idle() && !isBatchCanvasSaveActive(id)),
  async flush() {
    for (const id of deletionGuards.keys()) await saves.flush(id);
  },
});

export function useProductCanvasSave<T>(
  projectId: string,
  snapshot: T,
  ready: () => boolean,
  persist: (snapshot: T, options?: { deferSQLiteFlush?: boolean }) => Promise<void>,
  canDelete: () => boolean = () => true,
  beforeRelease?: () => Promise<void>,
  retiring = false,
  canRelease: () => boolean = () => true,
) {
  const [ticket, requestRender] = useState(0);
  const checkpointRef = useRef<ProductCommitCheckpoint<T> | null>(null);
  if (!checkpointRef.current)
    checkpointRef.current = new ProductCommitCheckpoint(requestRender);
  const checkpoint = checkpointRef.current;
  const persistRef = useRef(persist);
  const canDeleteRef = useRef(canDelete);
  const beforeReleaseRef = useRef(beforeRelease);
  const canReleaseRef = useRef(canRelease);
  useLayoutEffect(() => {
    if (retiring) return;
    checkpoint.mount();
    deletionGuards.set(projectId, () => canDeleteRef.current());
    const unregister = saves.register(projectId, async (options) => {
      try { await checkpoint.flush((value) => {
        // 批量生成期间，检查点可能在批量开始前已经排队。
        // 到达真正持久化边界时再次检查门控，避免这类在途检查点绕过批量保存策略。
        if (isBatchCanvasSaveActive(projectId) && !options?.forceBatch) {
          markBatchCanvasDirty(projectId);
          return Promise.resolve({ deferred: true });
        }
        if (options?.forceBatch)
          return withBatchCanvasCheckpoint(projectId, () => persistRef.current(value, options));
        return persistRef.current(value, options);
      }, options); } finally { productCanvasResidency.changed(); }
    },
      () => { checkpoint.acknowledgeDeferredSave(); productCanvasResidency.changed(); },
    );
    const idle = () => canDeleteRef.current() && canReleaseRef.current() && !isBatchCanvasSaveActive(projectId)
      && checkpoint.releaseProof()() && storageStatus().state !== "error";
    const unregisterResidency = productCanvasResidency.register(projectId, { idle, async prepare() {
      if (!idle() || storageStatus().state === "error" || !beforeReleaseRef.current) return null;
      await saves.flush(projectId);
      await flushSQLiteStorage();
      const proof = checkpoint.releaseProof();
      if (!idle() || !proof()) return null;
      await beforeReleaseRef.current();
      await flushSQLiteStorage();
      return () => idle() && proof() && storageStatus().state !== "error";
    } });
    return () => {
      unregisterResidency();
      unregister();
      deletionGuards.delete(projectId);
      checkpoint.unmount();
    };
  }, [checkpoint, projectId, retiring]);
  useLayoutEffect(() => {
    persistRef.current = persist;
    canDeleteRef.current = canDelete;
    beforeReleaseRef.current = beforeRelease;
    canReleaseRef.current = canRelease;
    if (!retiring) checkpoint.commit(ticket, snapshot, ready());
    productCanvasResidency.changed();
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
  const commitCurrent = useCallback(async (options: { deferSQLiteFlush?: boolean } = {}) => {
    if (workbookDeletionGate.getSnapshot()) throw new Error("工作簿删除保存尚未确认，请在原确认框重试保存后继续。");
    if (!useCanvasStore.getState().hydrated)
      throw new Error("产品数据尚未加载完成。");
    // 恢复门禁中的产品尚未挂载、不能编辑；统一ACK仍会排空已有保存。
    if (activeId && !productRestoreMountGate.getSnapshot().includes(activeId)
        && useCanvasStore.getState().openProject(activeId))
      await saves.flush(activeId, options);
    if (!options.deferSQLiteFlush) await flushSQLiteStorage();
  }, [activeId]);
  const enter = useCallback(
    async (id: string, options: { deferSQLiteFlush?: boolean } = {}) => {
      if (!useCanvasStore.getState().openProject(id))
        throw new Error("目标产品不存在，未切换画布。");
      const remembered = rememberWorkbookProduct(useCanvasStore.getState(), id);
      const previous = sqlitePreferences.getItem(ACTIVE_PRODUCT_KEY);
      const remember = () => {
        if (remembered) useCanvasStore.setState({ guanWorkbooks: remembered });
        sqlitePreferences.setItem(ACTIVE_PRODUCT_KEY, id);
      };
      if (!options.deferSQLiteFlush) remember();
      if (!options.deferSQLiteFlush) {
        try {
          // 新建、导入、恢复等首次入场仍须先等业务根和导航偏好真实ACK。
          await flushSQLiteStorage();
          if (!useCanvasStore.getState().openProject(id))
            throw new Error("保存期间目标产品已删除，未切换画布。");
        } catch (error) {
          // 只撤回失败的导航偏好，不删除已经创建的产品或覆盖业务数据。
          if (previous === null) sqlitePreferences.removeItem(ACTIVE_PRODUCT_KEY);
          else sqlitePreferences.setItem(ACTIVE_PRODUCT_KEY, previous);
          throw error;
        }
      }
      navigate(`/canvas/${encodeURIComponent(id)}`, {
        replace: true,
        // 产品导航由局部弹簧呈现，整页快照会逃离滚动裁剪并盖住回收站遮罩。
        flushSync: options.deferSQLiteFlush === true,
        viewTransition: false,
      });
      // 恢复中的产品由调用方走确认路径，普通缓存产品无需等待后台导航偏好ACK。
      productRestoreMountGate.release(id);
      // 普通切换先同步呈现目标，再发布导航偏好，避免旧画布多做一次同步渲染。
      if (options.deferSQLiteFlush) remember();
    },
    [navigate],
  );
  const selectProduct = useCallback(
    (id: string) =>
      operations.run(async () => {
        if (id === activeId) return false;
        if (workbookDeletionGate.getSnapshot()) throw new Error("工作簿删除保存尚未确认，请在原确认框重试保存后继续。");
        const state = useCanvasStore.getState();
        if (!state.hydrated) throw new Error("产品数据尚未加载完成。");
        if (!workbookProjects(state.projects, visibleWorkbookId(state, activeId)).some(project => project.id === id)) throw new Error("该产品不属于当前工作表。");
        // 未确认的恢复产品仍保留原持久化门禁，不能借普通切换提前挂载。
        if (productRestoreMountGate.getSnapshot().includes(id)) {
          await commitCurrent();
          await enter(id);
          return false;
        }
        // 普通产品切换先完成可见导航，不等待旧画布的React提交票据或SQLite/会话ACK。
        // 最近访问的画布保留热实例；旧画布在后台提交最新检查点。
        const release = productCanvasResidency.acquire(activeId);
        try { await enter(id, { deferSQLiteFlush: true }); } catch (error) { release(); throw error; }
        return release;
      }).then(async (switched) => {
        if (!switched) return;
        // 操作锁已释放，后台检查点/落盘不禁用胶囊；下一次点击可以立即切换。
        // 保留拒绝结果供胶囊显示错误；SQLite失败继续由原保存状态条提供重试。
        try {
          try { await commitCurrent({ deferSQLiteFlush: true }); }
          catch (error) { throw new Error(`已切换产品，但原画布保存尚未确认，内容仍保留，请切回原产品后重试。${error instanceof Error ? error.message : String(error)}`); }
          await flushSQLiteStorage();
          if (activeId) saves.acknowledge(activeId);
        } finally { switched(); }
      }),
    [activeId, commitCurrent, enter],
  );
  const createProduct = useCallback(
    () =>
      operations.run(async () => {
        await commitCurrent();
        const current = withVisibleSelection(useCanvasStore.getState(), activeId);
        useCanvasStore.setState({ guanWorkbooks: current.guanWorkbooks });
        const id = useCanvasStore.getState().createProject();
        const created = useCanvasStore.getState().openProject(id);
        if (!created) throw new Error("新建产品不存在，未切换画布。");
        const nodes = ensureProductParameterNode(created.nodes);
        if (nodes !== created.nodes) useCanvasStore.getState().updateProject(id, { nodes });
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
        const archived = recycledProducts(current).find(entry => entry.id === id);
        const next = archived?.nextProductId;
        const source = before.projects.find(project => project.id === id) || archived?.project;
        const scoped = workbookProjects(current.projects, source?.productSetId ?? null);
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
  const navigatePreparedWorkbook = useCallback(async (value: WorkbookSnapshot) => {
    const id = workbookEntry(value);
    if (id) {
      if (!useCanvasStore.getState().openProject(id)) throw new Error("目标产品不存在，未切换画布。");
      navigate(`/canvas/${encodeURIComponent(id)}`, {
        replace: true,
        viewTransition: false,
      });
      productRestoreMountGate.release(id);
    } else navigate("/", { replace: true });
  }, [navigate]);
  const commitPreparedWorkbook = useCallback((plan: () => WorkbookSnapshot, publish: (value: WorkbookSnapshot) => void) => operations.run(() => {
    let previousPreference: string | null = null, preferenceStaged = false;
    return commitWorkbookChange({
      // 工作簿变更有最终统一ACK；画布检查点只排入最新画布快照，避免先写整根再写一次工作簿根。
      commitCurrent: () => commitCurrent({ deferSQLiteFlush: true }),
      plan,
      prepare: value => prepareWorkbookEntry(value),
      publish: value => {
        previousPreference = sqlitePreferences.getItem(ACTIVE_PRODUCT_KEY);
        publish(value);
        const id = workbookEntry(value);
        if (id) sqlitePreferences.setItem(ACTIVE_PRODUCT_KEY, id);
        else sqlitePreferences.removeItem(ACTIVE_PRODUCT_KEY);
        preferenceStaged = true;
      },
      flush: async () => {
        await flushSQLiteStorage();
        if (activeId) saves.acknowledge(activeId);
      },
      navigate: navigatePreparedWorkbook,
      rollback: () => {
        if (!preferenceStaged) return;
        if (previousPreference === null) sqlitePreferences.removeItem(ACTIVE_PRODUCT_KEY);
        else sqlitePreferences.setItem(ACTIVE_PRODUCT_KEY, previousPreference);
      },
    });
  }), [activeId, commitCurrent, navigatePreparedWorkbook]);
  const selectWorkbook = useCallback((owner: string | null) => commitPreparedWorkbook(() => {
    const state = withVisibleSelection(useCanvasStore.getState(), activeId);
    return { ...state, guanWorkbooks: planWorkbookSelection(state, owner) };
  }, value => useCanvasStore.setState({ guanWorkbooks: value.guanWorkbooks })), [activeId, commitPreparedWorkbook]);
  const importWorkbook = useCallback((input: ExcelImportInput) => commitPreparedWorkbook(
    () => planExcelImport(withVisibleSelection(useCanvasStore.getState(), activeId), input),
    value => {
      const old = new Set(useCanvasStore.getState().projects.map(project => project.id));
      for (const project of value.projects) if (!old.has(project.id)) productRestoreMountGate.block(project.id);
      useCanvasStore.setState(value);
    },
  ), [activeId, commitPreparedWorkbook]);
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
  const restoreWorkbook = useCallback((owner: string, retry = false) => operations.run(async () => {
    if (retry) await retrySQLiteStorage();
    await commitCurrent();
    const before = useCanvasStore.getState();
    const entry = recycledWorkbookEntries(before.guanWorkbooks).find(item => item.id === owner);
    if (!entry) throw new Error("Excel 回收站中没有可恢复的工作簿。");
    const target = entry.activeProductId || entry.projects[0]?.id || entry.products[0]?.id || null;
    const next = planWorkbookRestore(before, owner);
    useCanvasStore.setState(next);
    await flushSQLiteStorage();
    if (target && useCanvasStore.getState().openProject(target)) await enter(target);
  }), [commitCurrent, enter]);
  const permanentlyDeleteWorkbook = useCallback((owner: string, retry = false) => operations.run(async () => {
    if (retry) await retrySQLiteStorage();
    await commitCurrent();
    const next = planWorkbookPermanentDelete(useCanvasStore.getState(), owner);
    useCanvasStore.setState(next);
    await flushSQLiteStorage();
  }), [commitCurrent]);
  return { activeId, busy, operationBusy, pendingWorkbookDeletion, createProduct, importProduct, selectProduct, recycleProduct, restoreProduct, selectWorkbook, importWorkbook, deleteWorkbook, restoreWorkbook, permanentlyDeleteWorkbook };
}
