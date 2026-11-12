import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { spring } from "motion";

type CapsuleFrame = { x: number; width: number };
type CapsulePlayback = { time(): number; finished: Promise<unknown>; cancel(): void };
type CapsuleMotionPort = {
  read(): CapsuleFrame;
  move(frame: CapsuleFrame): void;
  play(frames: CapsuleFrame[], duration: number): CapsulePlayback;
  setMoving?(moving: boolean): void;
};

export function capsuleOverflowDirection(frame: CapsuleFrame | null, scrollLeft: number, viewportWidth: number) {
  if (!frame || frame.width <= 0 || viewportWidth <= 0) return null;
  const right = frame.x + frame.width, end = scrollLeft + viewportWidth;
  // A capsule wider than the viewport cannot fit; keep its visible portion usable.
  if (frame.width > viewportWidth && right > scrollLeft && frame.x < end) return null;
  return frame.x < scrollLeft - 1 ? "left" : right > end + 1 ? "right" : null;
}

export function capsuleSlideSpring(distance: number, width: number, velocity = 0) {
  const reach = Math.min(1, Math.abs(distance) / Math.max(1, width) / 6);
  const stiffness = 420 + 560 * reach, mass = .8;
  // 远距离或快速改向提高阻尼，避免大跨度运动把背景甩过目标。
  const dampingRatio = Math.max(.73 + .25 * reach, Math.abs(velocity) > 900 ? .96 : 0);
  return { type: "spring" as const, stiffness, damping: 2 * Math.sqrt(stiffness * mass) * dampingRatio,
    mass, restDelta: .1, restSpeed: 2 };
}

export function createCapsuleSlideMotion(port: CapsuleMotionPort) {
  let revision = 0, target: CapsuleFrame | null = null;
  let active: { playback: CapsulePlayback; samples: CapsuleFrame[]; duration: number } | null = null;
  const stop = () => {
    revision++;
    active?.playback.cancel();
    active = null;
    port.setMoving?.(false);
  };
  const moveTo = (next: CapsuleFrame, immediate = false) => {
    const start = port.read(), carried: CapsuleFrame = { x: 0, width: 0 };
    if (active) {
      const interval = active.duration / (active.samples.length - 1);
      const index = Math.min(active.samples.length - 2, Math.max(0, Math.floor(active.playback.time() / interval)));
      for (const axis of ["x", "width"] as const)
        carried[axis] = (active.samples[index + 1][axis] - active.samples[index][axis]) * 1000 / interval;
    }
    // 先固定浏览器当前呈现值，再撤掉旧动画，避免取消时闪回底层样式。
    port.move(start);
    stop();
    target = next;
    if (immediate || start.x === next.x && start.width === next.width) { port.move(next); return; }
    const token = revision;
    const config = capsuleSlideSpring(next.x - start.x, next.width, carried.x);
    const axes = ["x", "width"] as const;
    const generators = axes.map(axis => spring({ ...config, keyframes: [start[axis], next[axis]], velocity: carried[axis] }));
    const samples: CapsuleFrame[] = [];
    const interval = 1000 / 120;
    let duration = 0;
    // 只在切换时采样一次，后续transform由浏览器执行，不依赖主线程逐帧写样式。
    for (let index = 0; index <= 180; index++) {
      duration = index * interval;
      const value = { ...next };
      let done = true;
      axes.forEach((axis, index) => {
        const sample = generators[index].next(duration);
        value[axis] = sample.value;
        done = done && sample.done;
      });
      samples.push(done ? next : value);
      if (done) break;
    }
    samples[samples.length - 1] = next;
    if (!duration) { port.move(next); return; }
    let playback: CapsulePlayback;
    try {
      port.setMoving?.(true);
      playback = port.play(samples, duration);
    } catch {
      port.move(next);
      port.setMoving?.(false);
      return;
    }
    active = { playback, samples, duration };
    const settle = () => {
      if (revision !== token) return;
      port.move(next);
      stop();
    };
    // 原生播放被外部取消时也要落到当前目标；旧播放的迟到取消不能覆盖新目标。
    void playback.finished.then(settle, settle);
  };
  return { moveTo, stop, finish() { stop(); if (target) port.move(target); } };
}

// 单一背景始终留在滚动内容坐标中，切换目标只改变弹簧终点。
export function useCapsuleSlide(activeId: string, owner: string | null, ownership: string, reduced: boolean | null) {
  const navigation = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const previousWorkbook = useRef<string | null | undefined>(undefined);
  const initialized = useRef(false);
  const movement = useRef<ReturnType<typeof createCapsuleSlideMotion> | null>(null);
  const [offscreen, setOffscreen] = useState<ReturnType<typeof capsuleOverflowDirection>>(null);
  const reveal = useRef<(() => void) | null>(null);
  if (!movement.current) movement.current = createCapsuleSlideMotion({
    setMoving: moving => {
      if (navigation.current) navigation.current.dataset.capsuleSliding = String(moving);
    },
    read: () => {
      const element = indicator.current!;
      const style = getComputedStyle(element);
      const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
      return { x: matrix.m41, width: (Number.parseFloat(style.width) || element.offsetWidth) * matrix.a };
    },
    move: value => {
      const element = indicator.current;
      if (!element) return;
      element.style.width = `${value.width}px`;
      element.style.transform = `translateX(${value.x}px)`;
    },
    play: (samples, duration) => {
      const element = indicator.current!, baseWidth = samples.at(-1)!.width;
      element.style.width = `${baseWidth}px`;
      const playback = element.animate(samples.map(value => ({
        transform: `translateX(${value.x}px) scaleX(${value.width / baseWidth})`,
      })), { duration, easing: "linear", fill: "both" });
      return { time: () => Number(playback.currentTime ?? 0), finished: playback.finished, cancel: () => playback.cancel() };
    },
  });
  useEffect(() => {
    const finishHidden = () => { if (document.visibilityState === "hidden") movement.current!.finish(); };
    document.addEventListener("visibilitychange", finishHidden);
    return () => { document.removeEventListener("visibilitychange", finishHidden); movement.current!.stop(); };
  }, []);
  useLayoutEffect(() => {
    const container = navigation.current, content = track.current;
    if (!container || !content || !indicator.current) return;
    const changedWorkbook = previousWorkbook.current !== owner;
    previousWorkbook.current = owner;
    let signature = "";
    let selection: { element: HTMLElement; frame: CapsuleFrame } | null = null;
    const updateDirection = () => setOffscreen(capsuleOverflowDirection(selection?.frame ?? null, container.scrollLeft, container.clientWidth));
    const scrollToSelected = (immediate: boolean) => {
      if (!selection) return;
      const { x: start, width: size } = selection.frame;
      const offset = start + size / 2 - container.clientWidth / 2;
      const scrollLeft = Math.max(0, Math.min(container.scrollWidth - container.clientWidth, offset));
      if (scrollLeft !== container.scrollLeft) container.scrollTo({ left: scrollLeft, behavior: immediate ? "instant" : "smooth" });
      updateDirection();
    };
    const revealSelected = () => {
      selection?.element.focus({ preventScroll: true });
      scrollToSelected(Boolean(reduced));
    };
    reveal.current = revealSelected;
    const measure = (resize = false) => {
      const selected = container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      const target = selected?.parentElement;
      if (!target) {
        selection = null;
        updateDirection();
        movement.current!.stop();
        initialized.current = false;
        if (changedWorkbook) container.scrollTo({ left: 0, behavior: "instant" });
        return;
      }
      // offset不包含按钮悬浮/按压缩放，也不包含滚动位移。
      const left = target.offsetLeft, size = target.offsetWidth, tall = target.offsetHeight;
      if (!size || !tall) return;
      selection = { element: selected!, frame: { x: left + content.offsetLeft, width: size } };
      const nextSignature = `${left}:${size}:${tall}:${container.clientWidth}`;
      if (resize && signature === nextSignature) return;
      signature = nextSignature;
      const immediate = !initialized.current || changedWorkbook || reduced || resize;
      movement.current!.moveTo({ x: left, width: size }, Boolean(immediate));
      indicator.current!.style.height = `${tall}px`;
      initialized.current = true;
      scrollToSelected(Boolean(immediate));
    };
    measure();
    container.addEventListener("scroll", updateDirection, { passive: true });
    const observer = new ResizeObserver(() => measure(true));
    observer.observe(container);
    observer.observe(content);
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", updateDirection);
      if (reveal.current === revealSelected) reveal.current = null;
    };
  }, [activeId, owner, ownership, reduced]);
  return { navigation, track, indicator, offscreen, revealSelected: () => reveal.current?.() };
}
