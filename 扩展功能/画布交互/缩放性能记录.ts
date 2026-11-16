// 仅显式开启的本机诊断，不采集产品内容，不发送数据。

type View = { x: number; y: number; k: number };
type Controller = { begin(view: View): void; move(view: View): void; finish(): void };
export function createCanvasGestureProbe(element: () => HTMLElement | null, controller?: () => Controller | null | undefined,
    read?: () => View) {
    const enabled = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("canvasPerformance") === "1";
    if (!enabled || typeof window === "undefined" || !["localhost", "127.0.0.1"].includes(window.location.hostname)) return undefined;
    let driveFrame = 0, armed = false;
    const benchmark = (event: KeyboardEvent) => {
        if (event.code !== "KeyP" || !event.ctrlKey || !event.shiftKey || !event.altKey || driveFrame) return;
        const port = controller?.(), root = element(), base = read?.();
        if (!port || !root || !base || root.closest('[data-product-active="false"]')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        window.focus(); armed = true;
        const cx = root.clientWidth / 2, cy = root.clientHeight / 2;
        const k = base.k > .2 ? .05 : .4;
        root.setAttribute("data-canvas-benchmark-state", "running");
        port.begin(base);
        port.move({ x: cx - (cx - base.x) / base.k * k, y: cy - (cy - base.y) / base.k * k, k });
        driveFrame = requestAnimationFrame(() => {
            driveFrame = 0; port.finish();
            root.setAttribute("data-canvas-benchmark-range", JSON.stringify({ from: base.k, to: read?.().k, focused: document.hasFocus() }));
        });
    };
    window.addEventListener("keydown", benchmark, true);
    let frame = 0, ending = 0, started = 0, previous = 0, active = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let sourceChanges = 0, removedImages = 0, addedImages = 0;
    const imageChanges = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === "attributes") sourceChanges++;
            else {
                const count = (nodes: NodeList) => [...nodes].reduce((sum, node) => sum + (node instanceof Element
                    ? node.querySelectorAll("img").length + Number(node.tagName === "IMG") : 0), 0);
                removedImages += count(record.removedNodes); addedImages += count(record.addedNodes);
            }
        }
    });
    let gaps: number[] = [], paints: number[] = [], commits: number[] = [], feedbackErrors: number[] = [];
    let slowFrames: Array<{ duration: number; script: number; layout: number }> = [];
    const observer = typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")
        ? new PerformanceObserver(list => {
            if (!active) return;
            for (const entry of list.getEntries()) {
                const value = entry as PerformanceEntry & { renderStart: number; styleAndLayoutStart: number; scripts: Array<{ duration: number }> };
                if (value.startTime < started) continue;
                slowFrames.push({ duration: Math.round(value.duration), script: Math.round(value.scripts.reduce((sum, item) => sum + item.duration, 0)),
                    layout: value.styleAndLayoutStart ? Math.round(value.startTime + value.duration - value.styleAndLayoutStart) : 0 });
            }
        }) : undefined;
    observer?.observe({ type: "long-animation-frame" });
    const sample = (time: number) => {
        if (!active) return;
        gaps.push(time - previous); previous = time;
        const slider = element()?.parentElement?.querySelector<HTMLInputElement>(".guan-canvas-zoom-dock input");
        const view = read?.();
        if (slider && view) feedbackErrors.push(Math.abs(Number(slider.value) - Math.round(view.k * 100)));
        frame = requestAnimationFrame(sample);
    };
    const rounded = (value: number) => Math.round(value * 10) / 10;
    const summary = (values: number[]) => {
        const sorted = values.toSorted((a, b) => a - b);
        return { count: values.length, p95: rounded(sorted[Math.floor(sorted.length * .95)] || 0),
            max: rounded(sorted.at(-1) || 0), total: rounded(values.reduce((sum, value) => sum + value, 0)) };
    };
    const finish = () => {
        if (!active || ending || settleTimer) return;
        settleTimer = setTimeout(() => {
        settleTimer = undefined;
        ending = requestAnimationFrame(() => { ending = requestAnimationFrame(() => {
            active = false; armed = false; ending = 0; cancelAnimationFrame(frame); imageChanges.disconnect();
            const root = element();
            if (!root) return;
            const result = JSON.stringify({
                duration: rounded(performance.now() - started), frames: summary(gaps),
                over33ms: gaps.filter(value => value > 33.4).length, paints: summary(paints), commits: summary(commits),
                feedback: summary(feedbackErrors),
                imagesChanged: { sourceChanges, removedImages, addedImages },
                nodes: root.querySelectorAll("[data-node-id]").length, images: root.querySelectorAll("img").length,
                slowFrames,
            });
            root?.setAttribute("data-canvas-performance", result);
            root?.setAttribute("aria-label", "本机缩放检查 " + result);
            root?.setAttribute("data-canvas-benchmark-state", "complete");
        }); });
        }, 750);
    };
    return {
        begin() {
            if (!armed) return;
            cancelAnimationFrame(frame); cancelAnimationFrame(ending); ending = 0;
            if (settleTimer) clearTimeout(settleTimer); settleTimer = undefined;
            active = true; gaps = []; paints = []; commits = []; feedbackErrors = []; slowFrames = []; started = previous = performance.now();
            sourceChanges = 0; removedImages = 0; addedImages = 0;
            const root = element();
            if (root) imageChanges.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
            frame = requestAnimationFrame(sample);
        },
        paint(duration: number) { if (active) paints.push(duration); },
        commit(duration: number) { if (active) commits.push(duration); },
        finish,
        dispose() {
            active = false; cancelAnimationFrame(frame); cancelAnimationFrame(ending); cancelAnimationFrame(driveFrame);
            if (settleTimer) clearTimeout(settleTimer); imageChanges.disconnect();
            window.removeEventListener("keydown", benchmark, true); observer?.disconnect();
        },
    };
}
