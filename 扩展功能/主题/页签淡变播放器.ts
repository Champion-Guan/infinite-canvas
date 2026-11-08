export const TAB_FADE_DURATION = 180;

// 只在目标变化时读取一次当前透明度，后续帧由浏览器播放。
export function createTabFadePlayer() {
    let running: Animation | null = null;
    let revision = 0;
    const stop = () => { revision++; running?.cancel(); running = null; };
    return {
        play(element: HTMLElement, entering: boolean, fromHidden: boolean, reduced: boolean, complete: () => void) {
            const current = fromHidden ? 0 : Number(getComputedStyle(element).opacity);
            stop();
            const token = revision;
            if (reduced || typeof element.animate !== "function" || Math.abs(current - Number(entering)) < .001) { complete(); return; }
            try {
                const animation = element.animate([{ opacity: Number.isFinite(current) ? current : 1 }, { opacity: entering ? 1 : 0 }],
                    { duration: TAB_FADE_DURATION, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" });
                running = animation;
                const finish = () => {
                    if (revision !== token || running !== animation) return;
                    if (entering) { running = null; animation.cancel(); }
                    complete();
                };
                void animation.finished.then(finish, finish);
            } catch { complete(); }
        },
        stop,
    };
}
