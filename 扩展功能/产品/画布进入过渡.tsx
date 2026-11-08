import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { useProductActive } from "./产品界面边界";

export function CanvasArrival({ ready, failed = false, background, loading, children }: {
  ready: boolean;
  failed?: boolean;
  background: string;
  loading: ReactNode;
  children: ReactNode;
}) {
  const active = useProductActive(), reduced = useReducedMotion();
  const scene = useRef<HTMLDivElement>(null);
  const painted = useRef(false);
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    if (ready || !active || failed) { setShowLoading(false); return; }
    const timer = setTimeout(() => setShowLoading(true), 160);
    return () => clearTimeout(timer);
  }, [ready, active, failed]);
  useLayoutEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const animations: Animation[] = [];
    const finish = () => {
      if (cancelled) return;
      painted.current = true;
      animations.forEach(animation => animation.cancel());
    };
    if (!active || reduced || !scene.current) { finish(); return; }
    if (painted.current) return;
    const duration = 200;
    try {
      animations.push(scene.current.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" }));
      void Promise.all(animations.map(animation => animation.finished)).then(finish, finish);
    } catch { finish(); }
    return () => { cancelled = true; animations.forEach(animation => animation.cancel()); };
  }, [ready, active, reduced]);
  return <div data-canvas-arrival={!ready ? failed ? "error" : "loading" : "ready"}
    aria-busy={!ready && !failed} style={{ position: "relative", height: "100%", background }}>
    <div ref={scene} style={{ height: "100%" }}>{ready ? children : null}</div>
    {!ready && (showLoading || failed) ? <div
      style={{ position: "absolute", inset: 0, zIndex: 60, background }}>
      {loading}
    </div> : null}
  </div>;
}
