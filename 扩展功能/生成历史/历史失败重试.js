// Read live state between slots; never restart a task that has since succeeded or is running.
export async function runHistoryRetries(targets, { getNode, isActive, onRetry, onError }) {
    const visited = new Set();
    for (const target of targets) {
        if (!isActive()) break;
        const key = JSON.stringify([target.node.id, target.imageId]);
        if (visited.has(key)) continue;
        visited.add(key);
        const node = getNode(target.node.id);
        if (!node || node.metadata?.status === "loading" || node.metadata?.images?.some(image => image.status === "loading")) continue;
        const media = target.imageId ? node.metadata?.images?.find(image => image.id === target.imageId) : node.metadata;
        if (!media) continue;
        const unavailable = target.unavailableStorageKey && media.storageKey === target.unavailableStorageKey;
        if (media.status !== "error" && !unavailable) continue;
        try { await onRetry(node, target.imageId); }
        catch (error) { onError(error); }
    }
}
