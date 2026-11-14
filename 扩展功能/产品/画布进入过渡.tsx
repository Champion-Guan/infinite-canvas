import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { useProductActive } from "./产品界面边界";
import { TAB_FADE_DURATION } from "../主题/页签淡变播放器";
import { finishStartupScreen } from "../本机存储/启动画面交接.mjs";

export function CanvasArrival({ ready, failed = false, background, loading, children }: {
  ready: boolean;
  failed?: boolean;
  background: string;
  loading: ReactNode;
  children: ReactNode;
}) {
  const active = useProductActive(), reduced = useReducedMotion();
  const scene = useRef<HTMLDivElement>(null);
  const loader = useRef<HTMLDivElement>(null);
  const painted = useRef(false);
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    if (ready || !active || failed) return;
    const timer = setTimeout(() => setShowLoading(true), 160);
    return () => clearTimeout(timer);
  }, [ready, active, failed]);
  useLayoutEffect(() => {
    if (active && (ready || failed) && finishStartupScreen() && ready) {
      painted.current = true;
      setShowLoading(false);
      return;
    }
    if (!ready) return;
    let cancelled = false;
    const animations: Animation[] = [];
    const finish = () => {
      if (cancelled) return;
      painted.current = true;
      setShowLoading(false);
      animations.forEach(animation => animation.cancel());
    };
    if (!active || reduced || !scene.current) { finish(); return; }
    if (painted.current) { finish(); return; }
    painted.current = true;
    try {
      animations.push(scene.current.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: TAB_FADE_DURATION, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" }));
      if (loader.current) animations.push(loader.current.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: TAB_FADE_DURATION, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" }));
      void Promise.all(animations.map(animation => animation.finished)).then(finish, finish);
    } catch { finish(); }
    return () => { cancelled = true; animations.forEach(animation => animation.cancel()); };
  }, [ready, failed, active, reduced]);
  return <div data-canvas-arrival={!ready ? failed ? "error" : "loading" : "ready"}
    aria-busy={!ready && !failed} style={{ position: "relative", height: "100%", background }}>
    <div ref={scene} style={{ height: "100%" }}>{ready ? children : null}</div>
    {showLoading || (!ready && failed) ? <div ref={loader} inert={ready} aria-hidden={ready || undefined}
      style={{ position: "absolute", inset: 0, zIndex: 60, background, pointerEvents: ready ? "none" : undefined }}>
      {loading}
    </div> : null}
  </div>;
}
