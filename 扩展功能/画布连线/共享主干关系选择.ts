import type { ConnectionGeometry } from "./圆角连线路由";

function routeLength(item: ConnectionGeometry) {
    return item.route?.points.slice(1).reduce((sum, point, index) => {
        const previous = item.route.points[index];
        return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
    }, 0) ?? 0;
}

export function sharedConnectionChoices(ids: readonly string[], geometry: readonly ConnectionGeometry[]) {
    const byId = new Map(geometry.map(item => [item.connection.id, item]));
    return [...new Set(ids)].flatMap(id => { const item = byId.get(id); return item ? [item] : []; }).sort((a, b) => routeLength(a) - routeLength(b) || a.connection.id.localeCompare(b.connection.id));
}

export function sharedConnectionAction(ids: readonly string[], geometry: readonly ConnectionGeometry[]) {
    const choices = sharedConnectionChoices(ids, geometry);
    if (!choices.length) return { type: "none" as const, choices };
    if (choices.length === 1) return { type: "select" as const, choices, id: choices[0].connection.id };
    return { type: "choose" as const, choices };
}
