// Aggregate all tasks, not just the most recently started task.
function representedConfigIds(nodes, connections) {
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    return new Set(connections.filter(connection => {
        const source = nodeById.get(connection.fromNodeId);
        const output = nodeById.get(connection.toNodeId);
        return source?.type === "config" && output?.type !== "config" && source.metadata?.generationStartedAt &&
            (output?.metadata?.generationStartedAt || 0) >= source.metadata.generationStartedAt;
    }).map(connection => connection.fromNodeId));
}

export function canvasTaskSummary(nodes, connections = []) {
    const representedConfigs = representedConfigIds(nodes, connections);
    const tracked = nodes.filter(node => !representedConfigs.has(node.id)).flatMap(node => {
        const metadata = node.metadata || {};
        const statuses = [metadata.status, ...(metadata.images || []).map(image => image.status), ...(metadata.texts || []).map(text => text.status)];
        // 图片类别、尺寸等只是配置；导入内容的success也不代表执行过生成。
        const hasTask = metadata.generationStartedAt ||
            (["image", "video", "audio", "text", "config"].includes(node.type) &&
            (metadata.generationType || metadata.videoTaskId || statuses.some(status => status === "loading" || status === "error")));
        return hasTask && statuses.some(status => ["loading", "error", "success"].includes(status)) ? [{ node, statuses }] : [];
    });
    const statuses = tracked.flatMap(task => task.statuses);
    const status = statuses.includes("loading") ? "loading" : statuses.includes("error") ? "error" : statuses.includes("success") ? "success" : "idle";
    const latest = tracked.reduce((best, { node }) => !best || (node.metadata?.generationStartedAt || 0) > (best.metadata?.generationStartedAt || 0) ? node : best, null);
    return { status, taskId: latest?.id || "", startedAt: latest?.metadata?.generationStartedAt || 0 };
}

export function failedTaskTargets(nodes, connections = []) {
    const representedConfigs = representedConfigIds(nodes, connections);
    return nodes.flatMap(node => {
        if (representedConfigs.has(node.id) || !["image", "video", "audio", "text", "config"].includes(node.type)) return [];
        if (node.metadata?.status === "loading" || node.metadata?.images?.some(image => image.status === "loading")) return [];
        const failedImages = node.metadata?.images?.filter(image => image.status === "error") || [];
        if (failedImages.length) return failedImages.map(image => ({ node, imageId: image.id }));
        return node.metadata?.status === "error" ? [{ node }] : [];
    });
}
