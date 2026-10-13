// Presentation only: never cancels generation, task polling or persistence.
export function startCanvasVisibility() {
    if (window.parent === window) return () => {};
    const paused = new Set<HTMLMediaElement>();
    let visible = (window.frameElement as HTMLElement | null)?.dataset.active !== "false";
    const pauseMedia = () => {
        if (visible) return;
        document.querySelectorAll<HTMLMediaElement>("video, audio").forEach(media => {
            if (!media.paused && !media.ended) {
                paused.add(media);
                media.pause();
            }
        });
    };
    const apply = () => {
        document.documentElement.dataset.guanCanvasVisible = String(visible);
        if (!visible) pauseMedia();
        else {
            for (const media of paused) {
                if (media.isConnected) void media.play().catch(() => {});
            }
            paused.clear();
        }
    };
    const receive = (event: MessageEvent) => {
        if (event.origin !== location.origin || event.source !== window.parent
            || event.data?.type !== "guan-canvas-visibility" || typeof event.data.visible !== "boolean") return;
        if (visible === event.data.visible) return;
        visible = event.data.visible;
        apply();
    };
    const observer = new MutationObserver(pauseMedia);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("play", pauseMedia, true);
    window.addEventListener("message", receive);
    apply();
    return () => {
        observer.disconnect();
        document.removeEventListener("play", pauseMedia, true);
        window.removeEventListener("message", receive);
        paused.clear();
        delete document.documentElement.dataset.guanCanvasVisible;
    };
}
