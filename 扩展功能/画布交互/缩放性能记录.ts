// 仅显式开启的本机诊断，不采集产品内容，不发送数据。

type View = { x: number; y: number; k: number };
type Controller = { begin(view: View): void; move(view: View): void; finish(): void };
export function isLocalCanvasDiagnosticHost(hostname: string) {
    return hostname === "localhost" || hostname === "127.0.0.1";
}

export function createCanvasGestureProbe(element: () => HTMLElement | null, controller?: () => Controller | null | undefined,
    read?: () => View) {
    if (typeof window === "undefined" || !isLocalCanvasDiagnosticHost(window.location.hostname)) return undefined;
    let driveFrame = 0, armed = false, releasedAt = 0, mode = "zoom";
    const benchmark = (event: KeyboardEvent) => {
        if (!(event.code === "KeyP" || event.code === "KeyO") || !event.ctrlKey || !event.shiftKey || !event.altKey || driveFrame || armed) return;
        const port = controller?.(), root = element(), base = read?.();
        if (!port || !root || !base || root.closest('[data-product-active="false"]')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        window.focus(); armed = true;
        mode = event.code === "KeyO" ? "pan" : "zoom";
        root.setAttribute("data-canvas-benchmark-state", "running");
        if (mode === "pan") {
            root.setAttribute("data-canvas-benchmark-range", JSON.stringify({ from: base.k, to: base.k, focused: document.hasFocus() }));
            port.begin(base);
            const start = performance.now();
            const move = () => {
                if (root.closest('[data-product-active="false"]')) { driveFrame = 0; port.finish(); return; }
                const progress = Math.min(1, (performance.now() - start) / 1200);
                if (progress === 1) {
                    port.move(base); driveFrame = 0; port.finish(); return;
                }
                port.move({ ...base, x: base.x + 80 * (1 - Math.abs(2 * progress - 1)) });
                driveFrame = requestAnimationFrame(move);
            };
            driveFrame = requestAnimationFrame(move);
            return;
        }
        const cx = root.clientWidth / 2, cy = root.clientHeight / 2;
        const k = base.k > .2 ? .05 : .4;
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
    let gaps: number[] = [], movingGaps: number[] = [], settleGaps: number[] = [], paints: number[] = [], commits: number[] = [], feedbackErrors: number[] = [];
    let slowFrames: Array<{ duration: number; script: number; layout: number; topScripts: Array<{ source: string; functionName: string; invoker: string; duration: number }> }> = [];
    const observer = typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")
        ? new PerformanceObserver(list => {
            if (!active) return;
            for (const entry of list.getEntries()) {
                const value = entry as PerformanceEntry & { renderStart: number; styleAndLayoutStart: number; scripts: Array<{ duration: number }> };
                if (value.startTime < started) continue;
                slowFrames.push({
                    duration: Math.round(value.duration),
                    script: Math.round(value.scripts.reduce((sum, item) => sum + item.duration, 0)),
                    layout: value.styleAndLayoutStart ? Math.round(value.startTime + value.duration - value.styleAndLayoutStart) : 0,
                    topScripts: [...value.scripts].sort((a, b) => b.duration - a.duration).slice(0, 3).map(item => {
                        const script = item as typeof item & { sourceURL?: string; sourceFunctionName?: string; invoker?: string };
                        return {
                            source: script.sourceURL?.split("/").slice(-3).join("/") || "",
                            functionName: script.sourceFunctionName || "",
                            invoker: script.invoker || "",
                            duration: Math.round(item.duration),
                        };
                    }),
                });
            }
        }) : undefined;
    observer?.observe({ type: "long-animation-frame" });
    const sample = (time: number) => {
        if (!active) return;
        const gap = time - previous;
        (releasedAt ? settleGaps : movingGaps).push(gap);
        gaps.push(gap); previous = time;
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
        releasedAt = performance.now();
        settleTimer = setTimeout(() => {
        settleTimer = undefined;
        ending = requestAnimationFrame(() => { ending = requestAnimationFrame(() => {
            active = false; armed = false; ending = 0; cancelAnimationFrame(frame); imageChanges.disconnect();
            const root = element();
            if (!root) return;
            const result = JSON.stringify({
                mode, duration: rounded(performance.now() - started), frames: summary(gaps),
                moving: summary(movingGaps), settling: summary(settleGaps),
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
            active = true; releasedAt = 0; gaps = []; movingGaps = []; settleGaps = []; paints = []; commits = []; feedbackErrors = []; slowFrames = []; started = previous = performance.now();
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
