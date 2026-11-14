import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { App, ConfigProvider } from "antd";
import { useTransientMessageTop } from "../存储界面/消息浮层布局";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useNativeTabFade } from "../主题/页签内容过渡";

const ProductSurfaceContext = createContext<{
  active: boolean;
  container: HTMLElement | null;
  retiringProject: CanvasProject | null;
  fadingOut: boolean;
  animateEntry: boolean;
  finishFade(): void;
} | null>(null);
export function useProductActive() {
  return useContext(ProductSurfaceContext)?.active ?? true;
}
export function useRetiringCanvasSnapshot() {
  return useContext(ProductSurfaceContext)?.retiringProject ?? null;
}

export function ProductCanvasScene({ children, ...props }: HTMLAttributes<HTMLElement>) {
  const scope = useContext(ProductSurfaceContext);
  const scene = useRef<HTMLElement>(null);
  useNativeTabFade(scene, scope?.active ?? true, scope?.animateEntry ?? false,
    !scope || scope.active || scope.fadingOut, () => scope?.finishFade());
  return <section {...props} ref={scene}>{children}</section>;
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
  retiringProject = null,
  fadingOut = false,
  animateEntry = false,
  onFadeOut,
}: {
  id: string;
  active: boolean;
  children: ReactNode;
  retiringProject?: CanvasProject | null;
  fadingOut?: boolean;
  animateEntry?: boolean;
  onFadeOut?: (id: string) => void;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const messageTop = useTransientMessageTop();
  const pausedMedia = useRef(new Set<HTMLMediaElement>());
  const context = useMemo(() => ({ active, container, retiringProject, fadingOut, animateEntry,
    finishFade: () => onFadeOut?.(id) }), [active, container, retiringProject, fadingOut, animateEntry, onFadeOut, id]);
  const popupContainer = useMemo(() => () => container!, [container]);
  const messageConfig = useMemo(() => ({ getContainer: popupContainer, top: messageTop }), [popupContainer, messageTop]);
  const notificationConfig = useMemo(() => ({ getContainer: popupContainer }), [popupContainer]);
  useEffect(() => {
    if (!container) return;
    // 旧版canvas-visibility的展示行为：只暂停媒体，不停止任务或保存。
    const paused = pausedMedia.current;
    const pause = () => {
      if (active && !retiringProject) return;
      container
        .querySelectorAll<HTMLMediaElement>("video,audio")
        .forEach((media) => {
          if (!media.paused && !media.ended) {
            paused.add(media);
            media.pause();
          }
        });
    };
    if (active && !retiringProject) {
      for (const media of paused)
        if (media.isConnected) void media.play().catch(() => {});
      paused.clear();
    } else pause();
    container.addEventListener("play", pause, true);
    return () => container.removeEventListener("play", pause, true);
  }, [active, container, retiringProject]);
  return (
    <div
      ref={setContainer}
      data-product-id={id}
      data-product-active={active ? "true" : "false"}
      data-product-retiring={retiringProject ? "true" : undefined}
      aria-hidden={!active}
      inert={!active || Boolean(retiringProject)}
      style={{
        position: "absolute",
        inset: 0,
        visibility: active || fadingOut ? "visible" : "hidden",
        pointerEvents: active && !retiringProject ? "auto" : "none",
        // 显隐和 inert 已隔离缓存产品；此处不能创建层叠上下文，
        // 否则产品内弹窗/消息会被外部顶栏和全局弹窗盖住。
      }}
    >
      {container ? (
        <ProductSurfaceContext.Provider value={context}>
          <ConfigProvider
            getPopupContainer={popupContainer}
            getTargetContainer={popupContainer}
          >
            <App
              style={{ height: "100%" }}
              message={messageConfig}
              notification={notificationConfig}
            >
              <div data-product-tab-scene={active ? "current" : fadingOut ? "leaving" : "hidden"} style={{ height: "100%", minHeight: 0 }}>{children}</div>
            </App>
          </ConfigProvider>
        </ProductSurfaceContext.Provider>
      ) : null}
    </div>
  );
}
