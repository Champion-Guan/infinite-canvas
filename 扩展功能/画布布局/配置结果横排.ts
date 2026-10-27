import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { expandChangedGroups, NODE_PLACEMENT_GAP, nodesOverlap } from "./卡片自动避让";

const names = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const valid = (node: CanvasNodeData) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
    && Number.isFinite(node.width) && Number.isFinite(node.height) && node.width > 0 && node.height > 0;

/** 只在显式整理时横排同配置的图片结果，不修改业务连线、名称、尺寸或生成任务。 */
export function arrangeConfigResultRows(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const incoming = new Map<string, Set<string>>(), outgoing = new Map<string, Set<string>>();
    for (const edge of connections) {
        if (!byId.has(edge.fromNodeId) || !byId.has(edge.toNodeId)) continue;
        if (!outgoing.has(edge.fromNodeId)) outgoing.set(edge.fromNodeId, new Set());
        if (!incoming.has(edge.toNodeId)) incoming.set(edge.toNodeId, new Set());
        outgoing.get(edge.fromNodeId)!.add(edge.toNodeId);
        incoming.get(edge.toNodeId)!.add(edge.fromNodeId);
    }
    const groups = nodes.flatMap(source => {
        if (source.type !== "config" || !valid(source)) return [];
        const outputs = [...(outgoing.get(source.id) ?? [])].map(id => byId.get(id)!);
        // 只放宽配置的多图片输出；跨配置汇入、下游还有分支的图片和其他关系不强行改排。
        if (outputs.length < 2 || outputs.some(node => node.type !== "image" || !valid(node)
            || incoming.get(node.id)?.size !== 1 || outgoing.get(node.id)?.size)) return [];
        outputs.sort((a, b) => names.compare(a.title || "", b.title || "") || names.compare(a.id, b.id));
        return [{ source, outputs }];
    }).sort((a, b) => a.source.position.y + a.source.height / 2 - b.source.position.y - b.source.height / 2
        || a.source.position.x - b.source.position.x || names.compare(a.source.id, b.source.id));
    if (!groups.length) return nodes;

    // 一次规划全部行，不能把另一行即将归位的旧图片位置误当成永久障碍。
    const moving = new Set(groups.flatMap(group => group.outputs.map(node => node.id)));
    const occupied = nodes.filter(node => node.type !== "group" && !moving.has(node.id) && valid(node));
    const replacements = new Map<string, CanvasNodeData>();
    for (const { source, outputs } of groups) {
        const centerY = source.position.y + source.height / 2;
        const height = Math.max(...outputs.map(node => node.height));
        const width = outputs.reduce((sum, node) => sum + node.width, 0) + NODE_PLACEMENT_GAP * (outputs.length - 1);
        let x = source.position.x + source.width + 96;
        // 整行只向右寻找空位，保持同高和排序，不把其中一张推到最下方。
        for (let attempt = 0; attempt <= occupied.length; attempt++) {
            const row = { ...source, position: { x, y: centerY - height / 2 }, width, height };
            const hits = occupied.filter(node => nodesOverlap(row, node, NODE_PLACEMENT_GAP));
            if (!hits.length) break;
            x = Math.max(...hits.map(node => node.position.x + node.width + NODE_PLACEMENT_GAP));
        }
        for (const node of outputs) {
            const position = { x, y: centerY - node.height / 2 };
            const placed = node.position.x === position.x && node.position.y === position.y ? node : { ...node, position };
            if (placed !== node) replacements.set(node.id, placed);
            occupied.push(placed);
            x += node.width + NODE_PLACEMENT_GAP;
        }
    }
    if (!replacements.size) return nodes;
    return expandChangedGroups(nodes.map(node => replacements.get(node.id) ?? node), new Set(replacements.keys()));
}
