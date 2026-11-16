// 多个可见卡片共用读取并发预算，原图下载、编辑和生成不经过此队列。
export function createPreviewReadQueue(concurrency = 3) {
    let active = 0;
    const pending: Array<() => void> = [];
    const drain = () => {
        while (active < concurrency && pending.length) pending.shift()!();
    };
    return <T,>(read: () => Promise<T>): Promise<T> => new Promise((resolve, reject) => {
        pending.push(() => {
            active++;
            void Promise.resolve().then(read).then(resolve, reject).finally(() => {
                active--;
                // 读取/解码本身异步；不再额外等待可能被后台节流的计时器。
                queueMicrotask(drain);
            });
        });
        drain();
    });
}
