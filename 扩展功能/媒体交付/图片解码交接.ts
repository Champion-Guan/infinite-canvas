type ReadyImage = { key: string; source: string; edge: number; revision: number };

// 当前画布已经显示的清晰图不降级；迟到解码不能覆盖新图片或新请求。
export function createImageHandoff() {
    let ready: ReadyImage | undefined, epoch = 0;
    return {
        current: () => ready,
        cancel: () => { epoch++; },
        prepare(key: string, edge: number, revision: number) {
            if (ready?.key === key && ready.edge >= edge && ready.revision === revision) return undefined;
            const ticket = ++epoch;
            const targetEdge = ready?.key === key ? Math.max(edge, ready.edge) : edge;
            return { edge: targetEdge, accept(source: string) {
                if (ticket !== epoch || !source) return undefined;
                ready = { key, source, edge: targetEdge, revision };
                return ready;
            } };
        },
    };
}

export function validImageSource(source?: string) {
    return source && /^(data:image\/|blob:|https?:\/\/)/.test(source)
        && !source.startsWith("blob:guan-deferred:") ? source : undefined;
}

export async function decodeImageSource(source: string) {
    const image = new Image();
    image.decoding = "async";
    image.src = source;
    await image.decode();
    if (!image.naturalWidth) throw new Error("图片解码未完成");
}
