import type { ConnectionGeometry } from "./圆角连线路由";

export function buildConnectionFocus(geometry: readonly ConnectionGeometry[], selectedNodeIds: ReadonlySet<string>, selectedConnectionId: string | null) {
    const nodeIds = new Set<string>(), connectionIds = new Set<string>(), protectedNodeIds = new Set<string>();
    const add = (item: ConnectionGeometry) => {
        connectionIds.add(item.connection.id);
        nodeIds.add(item.connection.fromNodeId);
        nodeIds.add(item.connection.toNodeId);
    };
    // 选中某一条线时只突出这一条，不连带点亮同一主干的其他目标。
    if (selectedConnectionId) {
        const item = geometry.find(item => item.connection.id === selectedConnectionId);
        if (item) { add(item); protectedNodeIds.add(item.from.id); protectedNodeIds.add(item.to.id); }
        return { nodeIds, connectionIds, protectedNodeIds };
    }
    if (selectedNodeIds.size !== 1) return { nodeIds, connectionIds, protectedNodeIds };
    const selected = [...selectedNodeIds][0];
    const incoming = new Map<string, ConnectionGeometry[]>();
    for (const item of geometry) {
        if (!incoming.has(item.connection.toNodeId)) incoming.set(item.connection.toNodeId, []);
        incoming.get(item.connection.toNodeId)!.push(item);
    }
    nodeIds.add(selected);
    protectedNodeIds.add(selected);
    if (!incoming.has(selected)) {
        geometry.filter(item => item.connection.fromNodeId === selected).forEach(add);
        nodeIds.forEach(id => protectedNodeIds.add(id));
    } else {
        // 从图片B向上追溯来源；不会顺着共享来源扩散到图片C、D等其他分支。
        const queue = [selected], visited = new Set<string>();
        for (let index = 0; index < queue.length; index++) {
            const id = queue[index];
            if (visited.has(id)) continue;
            visited.add(id);
            for (const item of incoming.get(id) ?? []) {
                add(item);
                if (!visited.has(item.connection.fromNodeId)) queue.push(item.connection.fromNodeId);
            }
        }
        // 最初来源及选中的图片B保持清晰，沿途的配置、提示词卡片允许半透明。
        for (const id of nodeIds) if (!(incoming.get(id) ?? []).some(item => connectionIds.has(item.connection.id))) protectedNodeIds.add(id);
    }
    // 配置的选择与悬浮都展示整组输出，端点全部保护，不能互相淡化。
    if (geometry.some(item => item.from.id === selected && item.from.type === "config")) {
        for (const item of geometry) if (item.from.id === selected) { add(item); protectedNodeIds.add(item.to.id); }
        protectedNodeIds.add(selected);
    }
    return { nodeIds, connectionIds, protectedNodeIds };
}

// 悬浮用于临时查看，离开后恢复原有选择；不改动持久化或卡片选择。
export function connectionInteractionFocus(geometry: readonly ConnectionGeometry[], selectedNodeIds: ReadonlySet<string>, selectedConnectionId: string | null, hoveredNodeId: string | null) {
    if (!hoveredNodeId) return buildConnectionFocus(geometry, selectedNodeIds, selectedConnectionId);
    const focus = buildConnectionFocus(geometry, new Set([hoveredNodeId]), null);
    // 悬浮配置卡片时同时展示直接输出；悬浮结果仍只追溯自己的来源。
    for (const item of geometry) if (item.connection.fromNodeId === hoveredNodeId) {
        focus.connectionIds.add(item.connection.id);
        focus.nodeIds.add(item.to.id);
    }
    return focus;
}
