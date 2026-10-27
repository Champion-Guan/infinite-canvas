import { useEffect, useState } from "react";

type ImageSize = { width: number; height: number };
type ImageResult = { image: ImageSize | null; error: string };

// 编辑器必须使用真实图片尺寸；加载失败不能用1024等默认值继续裁剪。
export function loadEditorImage(source: string, receive: (result: ImageResult) => void, {
    createImage = () => new Image(), timeoutMs = 15000,
    schedule = (callback: () => void, delay: number) => window.setTimeout(callback, delay),
    unschedule = (timer: number) => window.clearTimeout(timer),
} = {}) {
    const image = createImage();
    let active = true, timer: number | undefined;
    const dispose = () => {
        image.onload = null; image.onerror = null;
        if (timer !== undefined) unschedule(timer);
        image.removeAttribute("src");
    };
    const finish = (result: ImageResult) => {
        if (!active) return;
        active = false; dispose(); receive(result);
    };
    image.onload = () => {
        const width = image.naturalWidth, height = image.naturalHeight;
        finish(width > 0 && height > 0 ? { image: { width, height }, error: "" }
            : { image: null, error: "图片尺寸读取失败，请重试。" });
    };
    image.onerror = () => finish({ image: null, error: "图片读取失败，请确认原图仍可用后重试。" });
    timer = schedule(() => finish({ image: null, error: "图片读取超时，请重试。" }), timeoutMs);
    image.src = source;
    return () => { if (active) { active = false; dispose(); } };
}

export function useEditorImage(source: string, open: boolean) {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<ImageResult & { source: string; attempt: number }>({ image: null, error: "", source: "", attempt: -1 });
    useEffect(() => {
        if (!open || !source) return;
        setState({ image: null, error: "", source, attempt });
        return loadEditorImage(source, result => setState({ ...result, source, attempt }));
    }, [source, open, attempt]);
    const current = open && source === state.source && attempt === state.attempt;
    return { image: current ? state.image : null, error: current ? state.error : "", loading: !!source && open && (!current || !state.image && !state.error),
        retry: () => setAttempt(value => value + 1) };
}

export function EditorImageStatus({ error, loading, retry }: { error: string; loading: boolean; retry: () => void }) {
    if (error) return <div role="alert" className="mb-3 flex items-center gap-3 text-sm text-red-600 dark:text-red-400">
        <span>{error}</span><button type="button" className="shrink-0 underline underline-offset-4" onClick={retry}>重试读取</button>
    </div>;
    return loading ? <div role="status" className="mb-3 text-sm opacity-60">正在读取原图…</div> : null;
}
