import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { App, ConfigProvider } from "antd";

const ProductSurfaceContext = createContext<{
  active: boolean;
  container: HTMLElement | null;
} | null>(null);
export function useProductActive() {
  return useContext(ProductSurfaceContext)?.active ?? true;
}

// 只接管显式传入的本产品Portal，不拦截全局createPortal或修改作者DOM。
function ProductPortal({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: Element | DocumentFragment;
}) {
  const scope = useContext(ProductSurfaceContext);
  return createPortal(children, scope?.container || fallback);
}
export function createProductPortal(
  children: ReactNode,
  fallback: Element | DocumentFragment,
) {
  return <ProductPortal fallback={fallback}>{children}</ProductPortal>;
}

export function ProductSurface({
  id,
  active,
  children,
}: {
  id: string;
  active: boolean;
  children: ReactNode;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const pausedMedia = useRef(new Set<HTMLMediaElement>());
  const context = useMemo(() => ({ active, container }), [active, container]);
  useEffect(() => {
    if (!container) return;
    // 旧版canvas-visibility的展示行为：只暂停媒体，不停止任务或保存。
    const paused = pausedMedia.current;
    const pause = () => {
      if (active) return;
      container
        .querySelectorAll<HTMLMediaElement>("video,audio")
        .forEach((media) => {
          if (!media.paused && !media.ended) {
            paused.add(media);
            media.pause();
          }
        });
    };
    if (active) {
      for (const media of paused)
        if (media.isConnected) void media.play().catch(() => {});
      paused.clear();
    } else pause();
    container.addEventListener("play", pause, true);
    return () => container.removeEventListener("play", pause, true);
  }, [active, container]);
  return (
    <div
      ref={setContainer}
      data-product-id={id}
      data-product-active={active ? "true" : "false"}
      aria-hidden={!active}
      inert={!active}
      style={{
        position: "absolute",
        inset: 0,
        visibility: active ? "visible" : "hidden",
        pointerEvents: active ? "auto" : "none",
        // 显隐和 inert 已隔离缓存产品；此处不能创建层叠上下文，
        // 否则产品内弹窗/消息会被外部顶栏和全局弹窗盖住。
      }}
    >
      {container ? (
        <ProductSurfaceContext.Provider value={context}>
          <ConfigProvider
            getPopupContainer={() => container}
            getTargetContainer={() => container}
          >
            <App
              style={{ height: "100%" }}
              message={{ getContainer: () => container, top: 84 + 8 }}
              notification={{ getContainer: () => container }}
            >
              {children}
            </App>
          </ConfigProvider>
        </ProductSurfaceContext.Provider>
      ) : null}
    </div>
  );
}
