import { imageSizeRetryBlocked } from "../媒体交付/生成图片尺寸交付.mjs";

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

export function canvasTaskSummary(nodes, connections = [], includeEvents = false, productId) {
    const representedConfigs = representedConfigIds(nodes, connections);
    const allTracked = nodes.filter(node => includeEvents || !representedConfigs.has(node.id)).flatMap(node => {
        const metadata = node.metadata || {};
        const statuses = [metadata.status, ...(metadata.images || []).map(image => image.status), ...(metadata.texts || []).map(text => text.status)];
        // 图片类别、尺寸等只是配置；导入内容的success也不代表执行过生成。
        const hasTask = metadata.generationStartedAt ||
            (["image", "video", "audio", "text", "config"].includes(node.type) &&
            (metadata.gatewayGenerationTasks?.length || metadata.videoTaskId ||
                !metadata.generationNotificationCopy && metadata.generationType ||
                statuses.some(status => status === "loading" || status === "error")));
        const tracked = hasTask && statuses.some(status => ["loading", "error", "success"].includes(status)) ? [{ node, statuses }] : [];
        const planning = metadata.productPlanningTask;
        const owner = metadata.productPlanningTaskOwner;
        const ownPlanning = (!planning?.productId || !productId || planning.productId === productId)
            && (!planning?.nodeId || planning.nodeId === node.id)
            && (!owner || (!productId || owner.productId === productId) && owner.nodeId === node.id);
        if (node.type === "guan:prompt-variables" && typeof planning?.id === "string" && planning.id
            && ownPlanning && Number.isFinite(planning.startedAt) && ["loading", "error", "success"].includes(planning.status))
            tracked.push({ node, statuses: [planning.status], planning });
        return tracked;
    });
    const tracked = includeEvents ? allTracked.filter(({ node }) => !representedConfigs.has(node.id)) : allTracked;
    const statuses = tracked.flatMap(task => task.statuses);
    const status = statuses.includes("loading") ? "loading" : statuses.includes("error") ? "error" : statuses.includes("success") ? "success" : "idle";
    const started = task => task.planning?.startedAt || task.node.metadata?.generationStartedAt || 0;
    const latest = tracked.reduce((best, task) => !best || started(task) > started(best) ? task : best, null);
    // Include represented source configs in acknowledgements so deleting an
    // output cannot expose its already-seen source as a new completion.
    const events = includeEvents ? allTracked.flatMap(({ node, planning }) => {
        if (planning) return planning.status === "loading" ? [] : [{
            id: JSON.stringify([node.id, 0, "product-planning", "", [planning.id], planning.status]),
            status: planning.status, represented: false,
        }];
        const metadata = node.metadata || {};
        const tasks = metadata.gatewayGenerationTasks || [];
        const taskBySlot = new Map(tasks.map(task => [task.slotId, task.taskId]));
        const primary = metadata.primaryImageId || metadata.primaryTextId || node.id;
        const nodeTask = taskBySlot.get(primary) || taskBySlot.get(node.id) || tasks.at(-1)?.taskId;
        const slots = [
            ...(metadata.images || []).map((slot, index) => ({ key: `image:${slot.id || index}`, state: slot.status, taskId: taskBySlot.get(slot.id) })),
            ...(metadata.texts || []).map((slot, index) => ({ key: `text:${slot.id || index}`, state: slot.status, taskId: taskBySlot.get(slot.id) })),
        ];
        const nodeError = metadata.status === "error" && !slots.some(slot => slot.state === "error");
        const entries = [...(!slots.length || nodeError ? [{ key: "node", state: metadata.status, taskId: nodeTask }] : []), ...slots];
        return entries.filter(({ key, state, taskId }) => (state === "success" || state === "error")
            && (!metadata.generationNotificationCopy || taskId || key === "node" && metadata.generationStartedAt))
        .map(({ key, state, taskId }) => ({
            // A sibling retry may change the node timestamp and task list.
            // A slot's notification follows only its own immutable request ID.
            id: JSON.stringify([node.id, key === "node" && !taskId ? metadata.generationStartedAt || 0 : 0,
                key, key === "node" && !taskId ? metadata.videoTaskId || "" : "", taskId ? [taskId] : [], state]),
            status: state,
            represented: representedConfigs.has(node.id),
        }));
    }).sort((a, b) => a.id.localeCompare(b.id)) : [];
    return { status, taskId: latest?.node.id || "", startedAt: latest ? started(latest) : 0,
        ...(includeEvents ? { events } : {}) };
}

export function failedTaskTargets(nodes, connections = []) {
    const representedConfigs = representedConfigIds(nodes, connections);
    return nodes.flatMap(node => {
        if (representedConfigs.has(node.id) || !["image", "video", "audio", "text", "config"].includes(node.type)) return [];
        if (node.metadata?.status === "loading" || node.metadata?.images?.some(image => image.status === "loading")) return [];
        const failedImages = node.metadata?.images?.filter(image => image.status === "error") || [];
        if (failedImages.length) return failedImages.filter(image => !imageSizeRetryBlocked(image)).map(image => ({ node, imageId: image.id }));
        return node.metadata?.status === "error" && !imageSizeRetryBlocked(node.metadata) ? [{ node }] : [];
    });
}
