export type CanvasScaleFeedback = ReturnType<typeof createCanvasScaleFeedback>;

export function createCanvasScaleFeedback(initial = 1) {
    let scale = Number.isFinite(initial) && initial > 0 ? initial : 1;
    const listeners = new Set<() => void>();
    return {
        getSnapshot: () => scale,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        publish(next: number) {
            if (!Number.isFinite(next) || next <= 0 || next === scale) return;
            scale = next;
            listeners.forEach(listener => listener());
        },
    };
}
