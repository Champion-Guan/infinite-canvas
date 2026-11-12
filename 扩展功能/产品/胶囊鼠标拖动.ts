import { useEffect, type RefObject } from "react";

export function bindCapsuleMouseDrag(container: HTMLElement, host: EventTarget) {
  let gesture: { id: number; x: number; left: number; dragging: boolean } | null = null;
  let suppressClick = false;
  const finish = () => {
    const current = gesture;
    gesture = null;
    delete container.dataset.capsuleDragging;
    if (current && container.hasPointerCapture(current.id)) container.releasePointerCapture(current.id);
  };
  const down = (event: Event) => {
    const e = event as PointerEvent;
    suppressClick = false;
    if (e.pointerType !== "mouse" || e.button !== 0 || !e.isPrimary || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey
      || container.scrollWidth <= container.clientWidth) return;
    finish();
    gesture = { id: e.pointerId, x: e.clientX, left: container.scrollLeft, dragging: false };
  };
  const move = (event: Event) => {
    const e = event as PointerEvent, current = gesture;
    if (!current || current.id !== e.pointerId) return;
    const delta = e.clientX - current.x;
    if (!current.dragging && Math.abs(delta) < 6) return;
    if (!current.dragging) {
      current.dragging = true;
      suppressClick = true;
      container.dataset.capsuleDragging = "true";
      container.setPointerCapture(current.id);
      container.scrollTo({ left: container.scrollLeft, behavior: "instant" });
    }
    e.preventDefault();
    container.scrollLeft = Math.max(0, Math.min(container.scrollWidth - container.clientWidth, current.left - delta));
  };
  const up = (event: Event) => {
    if ((event as PointerEvent).pointerId === gesture?.id) finish();
  };
  const click = (event: Event) => {
    if (!suppressClick || (event as MouseEvent).detail === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const drag = (event: Event) => { if (gesture) event.preventDefault(); };
  container.addEventListener("pointerdown", down, true);
  container.addEventListener("click", click, true);
  container.addEventListener("dragstart", drag);
  container.addEventListener("lostpointercapture", finish);
  host.addEventListener("pointermove", move, { passive: false });
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);
  host.addEventListener("blur", finish);
  return () => {
    finish();
    container.removeEventListener("pointerdown", down, true);
    container.removeEventListener("click", click, true);
    container.removeEventListener("dragstart", drag);
    container.removeEventListener("lostpointercapture", finish);
    host.removeEventListener("pointermove", move);
    host.removeEventListener("pointerup", up);
    host.removeEventListener("pointercancel", up);
    host.removeEventListener("blur", finish);
  };
}

export function useCapsuleMouseDrag(navigation: RefObject<HTMLElement | null>, owner: string | null | undefined) {
  useEffect(() => {
    const container = navigation.current;
    if (container) return bindCapsuleMouseDrag(container, window);
  }, [navigation, owner]);
}
