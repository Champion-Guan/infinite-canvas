import type { CanvasConnection } from "@/types/canvas";

// 旧Excel导入可能让多条关系共用同一个时间戳ID。交互使用端点区分，
// 不改写原画布记录，也不让选择或删除一条线影响同编号的其他关系。
export function connectionSelectionKey(connection: CanvasConnection) {
    return `canvas-relation:${encodeURIComponent(JSON.stringify([connection.id, connection.fromNodeId, connection.toNodeId]))}`;
}

export function connectionMatchesSelection(connection: CanvasConnection, selection: string) {
    return selection === connection.id || selection === connectionSelectionKey(connection);
}

// 过期的原始重复ID没有足够信息确定关系，拒绝猜选。
export function selectedConnection(connections: readonly CanvasConnection[], selection: string) {
    const matches = connections.filter(connection => connectionMatchesSelection(connection, selection));
    return matches.length === 1 ? matches[0] : undefined;
}
