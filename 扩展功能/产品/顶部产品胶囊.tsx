import {
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
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
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { APPLE_CONTROL_SPRING } from "../主题/苹果动效";
import { useCapsuleSlide } from "./胶囊滑动动效";
import { useCapsuleMouseDrag } from "./胶囊鼠标拖动";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AppleActionButton } from "../主题/苹果交互按钮";

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
          task: canvasTaskSummary(project.nodes, project.connections, true),
        };
        taskCache.set(project.nodes, cached);
      }
      const { status, taskId, startedAt, events = [] } = cached.task;
      const title = productDisplayName(project, index),
        fingerprint = JSON.stringify([status, taskId, startedAt, events]);
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
        const [status, taskId, startedAt, events] = JSON.parse(product.fingerprint);
        return JSON.stringify({ status, taskId, startedAt, events });
      }
      return sqlitePreferences.getItem(key);
    },
    setItem(key: string, value: string) {
      sqlitePreferences.setItem(key, value);
    },
  };
}

export function ProductCapsules() {
  const reducedMotion = useReducedMotion();
  const selector = useMemo(createSummarySelector, []);
  const { activeId, busy, selectProduct } = useProductNavigation();
  const allProducts = useCanvasStore(selector);
  const owner = useCanvasStore(state => visibleWorkbookId(state, activeId));
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
  const { navigation, track, indicator, offscreen, revealSelected } = useCapsuleSlide(activeId, owner, ownership, reducedMotion);
  useCapsuleMouseDrag(navigation, owner);
  const currentStatus = current ? readCanvasCapsuleStatus(current.id, true, { ...capsuleStorage(current), setItem() {} },
    visibility !== "hidden", entering) : "idle";
  const select = (id: string, acknowledgeCurrent = false) => {
    if (busy) return;
    if (id === activeId) {
      if (acknowledgeCurrent) setLastSelectedId("");
      return;
    }
    setError("");
    void selectProduct(id).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  const navigateTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    if (busy || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLElement)
        || event.target.getAttribute("role") !== "tab") return;
    const tabs = Array.from(navigation.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const index = tabs.indexOf(event.target as HTMLButtonElement);
    const target = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1)
      : event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length]
      : event.key === "ArrowLeft" ? tabs[(index - 1 + tabs.length) % tabs.length] : null;
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
    select(target.dataset.productId!);
  };
  useLayoutEffect(() => {
    if (lastSelectedId === activeId) return;
    if (!current) {
      if (!activeId) setLastSelectedId("");
      return;
    }
    if (visibility === "hidden") return;
    // Entering acknowledges only completed events; running tasks stay yellow
    // and their later completion still produces its own unread event.
    readCanvasCapsuleStatus(
      current.id,
      true,
      capsuleStorage(current),
      true,
      true,
    );
    setLastSelectedId(activeId);
  }, [activeId, current, visibility, lastSelectedId]);
  return (
    <div className={styles.root}>
      <div
        ref={navigation}
        className="guan-dc-product-nav"
        role="tablist"
        aria-label="当前工作表产品"
        aria-busy={busy}
        onKeyDown={navigateTabs}
      >
        <div className={styles.scrollContent}>
        <div ref={track} className={styles.track}>
          <span
            ref={indicator}
            aria-hidden="true"
            hidden={!current}
            data-product-indicator={current ? activeId : undefined}
            data-status={currentStatus}
            className={styles.indicator}
            style={{ borderRadius: 999 }}
          />
        {products.map((product, index) => {
          const active = product.id === activeId;
          const storage = capsuleStorage(product);
          // 渲染只读。旧函数的写入只在上面的真实提交阶段执行，不在render修改SQLite。
          const status = active ? currentStatus : readCanvasCapsuleStatus(
            product.id,
            active,
            { ...storage, setItem() {} },
            visibility !== "hidden",
            active && entering,
          );
          const label = productDisplayName(product, index);
          return (
            <div key={product.id} className="guan-product-capsule-wrap">
              <motion.button
                type="button"
                whileHover={reducedMotion || busy ? undefined : { y: -1, scale: 1.015 }}
                whileTap={reducedMotion || busy ? undefined : { y: 0, scale: .97 }}
                transition={reducedMotion ? { duration: 0 } : APPLE_CONTROL_SPRING}
                className={`guan-dc-product-capsule guan-dc-product-capsule-${status} ${active ? "is-active" : ""}`}
                role="tab"
                aria-selected={active}
                tabIndex={active || !current && index === 0 ? 0 : -1}
                data-product-id={product.id}
                title={label}
                disabled={busy}
                onClick={() => select(product.id, true)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
                  <circle cx="8.5" cy="9" r="1.5" />
                  <path d="m5.5 17 4.4-4.4 3.2 3.2 2.2-2.2 3.2 3.4" />
                </svg>
                <span>{label}</span>
              </motion.button>
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
        <div className={styles.edgeLayer}>
      {(["left", "right"] as const).map(side => {
        const shown = Boolean(current && offscreen === side);
        const direction = side === "left" ? "左" : "右";
        return <div key={side} className={`${styles.edgeHint} ${styles[side]}`}
          data-capsule-location={side} data-visible={shown} aria-hidden={!shown} inert={!shown}>
          <AppleActionButton className={styles.edgeButton} data-status={currentStatus}
            disabled={!shown} tabIndex={shown ? 0 : -1}
            aria-label={`当前产品在${direction}侧：${current?.title ?? ""}，点击定位`}
            title={`定位当前产品：${current?.title ?? ""}`} onClick={revealSelected}>
            {side === "left" ? <ChevronLeft size={16} aria-hidden="true" /> : null}
            <span className={styles.edgePrefix}>当前</span>
            <span className={styles.edgeName}>{current?.title}</span>
            {side === "right" ? <ChevronRight size={16} aria-hidden="true" /> : null}
          </AppleActionButton>
        </div>;
      })}
        </div>
        </div>
      </div>
      <AnimatePresence>{deleting ? <ProductDeleteDialog key={deleting.id} id={deleting.id} name={deleting.name} onClose={() => setDeleting(null)} /> : null}</AnimatePresence>
      {error ? (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
