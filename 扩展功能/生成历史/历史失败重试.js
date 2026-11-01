// Read live state between slots; never restart a task that has since succeeded or is running.
export async function runHistoryRetries(targets, { getNode, isActive, onRetry, onError }) {
    const visited = new Set();
    const eligible = [];
    for (const target of targets) {
        if (!isActive()) break;
        const key = JSON.stringify([target.node.id, target.imageId]);
        if (visited.has(key)) continue;
        visited.add(key);
        const node = getNode(target.node.id);
        if (!node) continue;
        const media = target.imageId ? node.metadata?.images?.find(image => image.id === target.imageId) : node.metadata;
        if (!media) continue;
        // 同一节点的不同图片槽位可以并行；只有目标槽位本身在运行时跳过。
        // 整卡重试仍保持原来的节点级 loading 门禁。
        if (target.imageId ? media.status === "loading" : node.metadata?.status === "loading" || node.metadata?.images?.some(image => image.status === "loading")) continue;
        const unavailable = target.unavailableStorageKey && media.storageKey === target.unavailableStorageKey;
        if (media.status !== "error" && !unavailable) continue;
        eligible.push({ ...target, node });
    }
    const run = async target => {
        if (!isActive()) return;
        const node = getNode(target.node.id);
        if (!node) return;
        const media = target.imageId ? node.metadata?.images?.find(image => image.id === target.imageId) : node.metadata;
        const unavailable = target.unavailableStorageKey && media?.storageKey === target.unavailableStorageKey;
        if (!media || media.status === "loading" || media.status !== "error" && !unavailable) return;
        await onRetry(node, target.imageId);
    };
    // 图片全部并行；历史中的视频等类型继续沿用逐项重试。
    const images = eligible.filter(target => target.node.type === "image");
    const others = eligible.filter(target => target.node.type !== "image");
    const results = await Promise.allSettled([
        ...images.map(run),
        (async () => {
            for (const target of others) {
                try { await run(target); }
                catch (error) { onError(error); }
            }
        })(),
    ]);
    results.forEach(result => { if (result.status === "rejected") onError(result.reason); });
}
