import {
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  useCanvasStore,
  type CanvasProject,
} from "@/stores/canvas/use-canvas-store";
import { sqlitePreferences } from "../本机存储/上游浏览器存储桥";
import { orderedWorkbookProjects, visibleWorkbookId } from "../Excel/Excel产品归属";
import { orderedProducts } from "./产品规则";
import { useProductNavigation } from "./产品操作";
import { canvasTaskSummary } from "./产品任务摘要.js";
import { productDisplayName } from "./旧版产品显示名.js";
import { readCanvasCapsuleStatus } from "./旧版产品胶囊状态.js";
import styles from "./产品胶囊.module.css";
import { ProductDeleteDialog, ProductTrashIcon } from "./产品回收面板";

type Summary = {
  id: string;
  title: string;
  createdAt: string;
  status: string;
  fingerprint: string;
};
function createSummarySelector() {
  let previous: Summary[] = [];
  const taskCache = new WeakMap<
    CanvasProject["nodes"],
    {
      connections: CanvasProject["connections"];
      task: ReturnType<typeof canvasTaskSummary>;
    }
  >();
  return (state: { projects: CanvasProject[] }) => {
    const previousById = new Map(previous.map((item) => [item.id, item]));
    const next = orderedProducts(state.projects).map((project, index) => {
      let cached = taskCache.get(project.nodes);
      if (!cached || cached.connections !== project.connections) {
        cached = {
          connections: project.connections,
          task: canvasTaskSummary(project.nodes, project.connections),
        };
        taskCache.set(project.nodes, cached);
      }
      const { status, taskId, startedAt } = cached.task;
      const title = productDisplayName(project, index),
        fingerprint = JSON.stringify([status, taskId, startedAt]);
      const old = previousById.get(project.id);
      return old &&
        old.title === title &&
        old.createdAt === project.createdAt &&
        old.fingerprint === fingerprint
        ? old
        : {
            id: project.id,
            title,
            createdAt: project.createdAt,
            status,
            fingerprint,
          };
    });
    if (
      next.length !== previous.length ||
      next.some((item, i) => item !== previous[i])
    )
      previous = next;
    return previous;
  };
}

function subscribeVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}
function getVisibility() {
  return document.visibilityState;
}
function capsuleStorage(product: Summary) {
  return {
    getItem(key: string) {
      if (key === `guan-canvas-status:${product.id}`) {
        const [status, taskId, startedAt] = JSON.parse(product.fingerprint);
        return JSON.stringify({ status, taskId, startedAt });
      }
      return sqlitePreferences.getItem(key);
    },
    setItem(key: string, value: string) {
      sqlitePreferences.setItem(key, value);
    },
  };
}

export function ProductCapsules() {
  const selector = useMemo(createSummarySelector, []);
  const { activeId, busy, selectProduct } = useProductNavigation();
  const allProducts = useCanvasStore(selector);
  const ownership = useCanvasStore(state => orderedWorkbookProjects(state.projects, visibleWorkbookId(state, activeId), state.guanWorkbooks?.contract.products).map(project => project.id).join("\n"));
  const byId = new Map(allProducts.map(product => [product.id, product]));
  const products = ownership.split("\n").flatMap(id => byId.get(id) ? [byId.get(id)!] : []);
  const [lastSelectedId, setLastSelectedId] = useState("");
  const visibility = useSyncExternalStore(
    subscribeVisibility,
    getVisibility,
    getVisibility,
  );
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const current = products.find((item) => item.id === activeId);
  const entering = lastSelectedId !== activeId;
  useLayoutEffect(() => {
    if (lastSelectedId === activeId) return;
    if (!current) {
      if (!activeId) setLastSelectedId("");
      return;
    }
    setLastSelectedId(activeId);
    if (current.status === "loading" || visibility === "hidden") return;
    // 与旧版相同：只在重新进入产品时确认通知；正在查看的任务结束仍显示成功/失败色。
    readCanvasCapsuleStatus(
      current.id,
      true,
      capsuleStorage(current),
      true,
      true,
    );
  }, [activeId, current, visibility, lastSelectedId]);
  return (
    <div className={styles.root}>
      <div
        className="guan-dc-product-nav guan-apple-scroll"
        role="tablist"
        aria-label="当前工作表产品"
        aria-busy={busy}
      >
        {products.map((product, index) => {
          const active = product.id === activeId;
          const storage = capsuleStorage(product);
          // 渲染只读。旧函数的写入只在上面的真实提交阶段执行，不在render修改SQLite。
          const status = readCanvasCapsuleStatus(
            product.id,
            active,
            { ...storage, setItem() {} },
            visibility !== "hidden",
            active && entering,
          );
          const label = productDisplayName(product, index);
          return (
            <div key={product.id} className="guan-product-capsule-wrap">
              <button
                type="button"
                className={`guan-dc-product-capsule guan-apple-action guan-apple-press guan-dc-product-capsule-${status} ${active ? "guan-shared-product-capsule is-active" : ""}`}
                role="tab"
                aria-selected={active}
                data-product-id={product.id}
                title={label}
                disabled={busy}
                onClick={() => {
                  setError("");
                  void selectProduct(product.id).catch((reason) =>
                    setError(
                      reason instanceof Error ? reason.message : String(reason),
                    ),
                  );
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
                  <circle cx="8.5" cy="9" r="1.5" />
                  <path d="m5.5 17 4.4-4.4 3.2 3.2 2.2-2.2 3.2 3.4" />
                </svg>
                <span>{label}</span>
              </button>
              <button type="button" className="guan-product-delete"
                aria-label={`删除${label}及对应画布`}
                title={product.status === "loading" ? "生成任务运行中，暂不能删除" : "删除产品及对应画布"}
                disabled={busy || product.status === "loading"}
                onClick={(event) => { event.stopPropagation(); setDeleting({ id: product.id, name: label }); }}>
                <ProductTrashIcon />
              </button>
            </div>
          );
        })}
      </div>
      {deleting ? <ProductDeleteDialog id={deleting.id} name={deleting.name} onClose={() => setDeleting(null)} /> : null}
      {error ? (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
