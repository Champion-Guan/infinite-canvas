import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";
import type { ProductPromptMetadata } from "../Excel画布/商品提示词规则";
import { expandChangedGroups, NODE_PLACEMENT_GAP, nodesOverlap } from "./卡片自动避让";
import { planWorkflowRows } from "./画布流程分组排布";

type Row = { source?: CanvasNodeData; prompt?: CanvasNodeData; translations: CanvasNodeData[]; config?: CanvasNodeData; orderNode: CanvasNodeData; outputs: Map<number, CanvasNodeData> };
type Columns = { parameter: number; source: number; prompt: number; translation?: number; config: number; outputs: Map<number, number> };


const compare = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const valid = (node: CanvasNodeData) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
    && Number.isFinite(node.width) && Number.isFinite(node.height) && node.width > 0 && node.height > 0;
const center = (node: CanvasNodeData) => node.position.y + node.height / 2;
const sorted = (a: CanvasNodeData, b: CanvasNodeData) => center(a) - center(b)
    || a.position.x - b.position.x || compare.compare(a.title || "", b.title || "") || a.id.localeCompare(b.id);
const isParameter = (node: CanvasNodeData) => node.type === "guan:prompt-variables";
const isPreview = (node: CanvasNodeData) => node.type === "text" && Boolean(node.metadata?.promptVariablePreviewOf);
const isMedia = (node: CanvasNodeData) => node.type === "image" || node.type === "video" || node.type === "audio";
const isPromptText = (node: CanvasNodeData) => node.type === "text" || node.type === "guan:product-prompt";
const isPromptSource = (node: CanvasNodeData) => node.type === "guan:product-prompt" || node.type === "text"
    && Boolean(node.metadata?.excelPromptLabel || node.metadata?.excelPromptKey || /(?:主图|详情页|富内容|视频)提示词/.test(node.title || ""));
const isTranslationCandidate = (node: CanvasNodeData) => node.type === "text"
    && (Boolean(node.metadata?.promptVariableTranslationOf) || /^(英文|中文|翻译).*提示词/.test(node.title || ""));

export function promptOrder(node: CanvasNodeData, fallbackPlanIndex = 0): { rank: number; number: number; label: string } {
    const label = String(node.metadata?.excelPromptLabel || node.title || "");
    const document = (node.metadata as ProductPromptMetadata | undefined)?.productImagePrompt;
    if (document && ["main", "carousel", "rich"].includes(document.kind)) {
        const rank = document.kind === "main" ? 0 : document.kind === "carousel" ? 1 : 2;
        return { rank, number: Number.isSafeInteger(document.planIndex) && document.planIndex! >= 0 ? document.planIndex! : fallbackPlanIndex, label };
    }
    const detail = label.match(/详情页(?:提示词)?\s*0*(\d+)?/i);
    const rich = label.match(/富内容(?:提示词)?\s*0*(\d+)?/i);
    const video = label.match(/视频(?:提示词)?\s*0*(\d+)?/i);
    if (/主图(?:提示词)?/i.test(label)) return { rank: 0, number: 0, label };
    if (detail) return { rank: 1, number: Number(detail[1] || 0), label };
    if (rich) return { rank: 2, number: Number(rich[1] || 0), label };
    if (video) return { rank: 4, number: Number(video[1] || 0), label };
    return { rank: 3, number: 0, label };
}

function comparePrompt(a: CanvasNodeData, b: CanvasNodeData, nodeOrder?: ReadonlyMap<string, number>) {
    const left = promptOrder(a, nodeOrder?.get(a.id)), right = promptOrder(b, nodeOrder?.get(b.id));
    return left.rank - right.rank || left.number - right.number || compare.compare(left.label, right.label) || a.id.localeCompare(b.id);
}

function connectionIndex(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const incoming = new Map<string, Set<string>>(), outgoing = new Map<string, Set<string>>();
    for (const edge of connections) {
        if (!byId.has(edge.fromNodeId) || !byId.has(edge.toNodeId) || edge.fromNodeId === edge.toNodeId) continue;
        if (!incoming.has(edge.toNodeId)) incoming.set(edge.toNodeId, new Set());
        if (!outgoing.has(edge.fromNodeId)) outgoing.set(edge.fromNodeId, new Set());
        incoming.get(edge.toNodeId)!.add(edge.fromNodeId);
        outgoing.get(edge.fromNodeId)!.add(edge.toNodeId);
    }
    return { byId, incoming, outgoing };
}

// 编号只决定结果列；无编号和重复编号按名称稳定占用空列。
function variantOutputColumns(nodes: CanvasNodeData[]) {
    const order = new Map(nodes.filter(node => isParameter(node)).flatMap(node =>
        ((node.metadata as { productVariants?: Array<{ id: string }> } | undefined)?.productVariants || [])
            .map((variant, index) => [JSON.stringify([node.id, variant.id]), index] as const)));
    const groups = new Map<string, { ids: string[]; left: number; order: number }>();
    for (const node of nodes) {
        const variant = (node.metadata as { productVariant?: { parameterId: string; id: string } } | undefined)?.productVariant;
        if (!variant || !isMedia(node)) continue;
        const key = JSON.stringify([variant.parameterId, variant.id, node.metadata?.generationBatchId || ""]);
        const group = groups.get(key) || { ids: [], left: node.position.x,
            order: order.get(JSON.stringify([variant.parameterId, variant.id])) ?? Number.MAX_SAFE_INTEGER };
        group.ids.push(node.id); group.left = Math.min(group.left, node.position.x); groups.set(key, group);
    }
    return new Map([...groups].sort((a, b) => a[1].order - b[1].order || a[1].left - b[1].left || a[0].localeCompare(b[0]))
        .flatMap(([, group], index) => group.ids.map(id => [id, index + 1] as const)));
}

function uniformVariantResultWidths(nodes: CanvasNodeData[], selectedIds?: ReadonlySet<string>) {
    const keyFor = (node: CanvasNodeData) => {
        const variant = (node.metadata as { productVariant?: { parameterId: string; id: string } } | undefined)?.productVariant;
        return node.type === "image" && variant && (!selectedIds || selectedIds.has(node.id))
            ? JSON.stringify([variant.parameterId, variant.id]) : undefined;
    };
    const widths = new Map<string, number>();
    for (const node of nodes) {
        const key = keyFor(node);
        if (key && valid(node)) widths.set(key, Math.max(widths.get(key) || 0, node.width));
    }
    return nodes.map(node => {
        const key = keyFor(node), width = key && widths.get(key);
        if (!width || !valid(node)) return node;
        const pixels = node.metadata;
        const ratio = pixels?.naturalWidth && pixels.naturalHeight ? pixels.naturalHeight / pixels.naturalWidth : node.height / node.width;
        const height = width * ratio;
        return Math.abs(node.width - width) < 1e-7 && Math.abs(node.height - height) < 1e-7 ? node
            : { ...node, width, height, position: { x: node.position.x, y: node.position.y + (node.height - height) / 2 } };
    });
}

function outputSlots(outputs: CanvasNodeData[], variantColumns: Map<string, number>) {
    const slots = new Map<number, CanvasNodeData>();
    const pending: CanvasNodeData[] = [];
    for (const node of outputs) {
        const slot = variantColumns.get(node.id);
        if (slot && !slots.has(slot)) slots.set(slot, node);
    }
    for (const node of [...outputs].sort((a, b) => compare.compare(a.title || "", b.title || "") || a.id.localeCompare(b.id))) {
        if ([...slots.values()].some(item => item.id === node.id)) continue;
        const match = (node.title || "").match(/[-－]\s*(\d+)\s*$/);
        const number = match ? Number(match[1]) : 0;
        if (number > 0 && number <= 1000 && !slots.has(number)) slots.set(number, node);
        else pending.push(node);
    }
    for (const node of pending) {
        let number = 1;
        while (slots.has(number)) number++;
        slots.set(number, node);
    }
    return slots;
}

function collectRows(nodes: CanvasNodeData[], index: ReturnType<typeof connectionIndex>) {
    const used = new Set<string>();
    const rows: Row[] = [];
    const variantColumns = variantOutputColumns(nodes);
    // 旧套图没有规划序号，保留原创建顺序；整理只改坐标，不改变节点数组顺序。
    const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
    for (const config of nodes.filter(node => {
        if (node.type !== "config" || !valid(node)) return false;
        const inputs = [...(index.incoming.get(node.id) || [])].map(id => index.byId.get(id)!);
        const hasMedia = inputs.some(isMedia);
        const hasPromptInput = inputs.some(input => isPromptText(input)
            && (isPromptSource(input) || isPreview(input) || isTranslationCandidate(input)));
        const referenceOnly = inputs.length > 0 && inputs.every(input => isMedia(input)
            && !index.incoming.get(input.id)?.size
            && !input.metadata?.generationType && !input.metadata?.generationImageType && !input.metadata?.generationNameBase);
        // 只有真实生成配置才进入统一配置列；普通单线配置仍留在参考图旁。
        const generatedReferenceConfig = referenceOnly && nodes.some(isTranslationCandidate);
        return !hasMedia || hasPromptInput || generatedReferenceConfig;
    }).sort(sorted)) {
        const inputs = [...(index.incoming.get(config.id) || [])].map(id => index.byId.get(id)!).filter(node => isPromptText(node) && valid(node));
        const translatedInput = inputs.find(node => {
            const sourceId = node.metadata?.promptVariableTranslationOf;
            return sourceId && index.incoming.get(node.id)?.has(sourceId)
                && inputs.every(item => item.id === node.id || item.id === sourceId);
        });
        const text = inputs.length === 1 ? inputs[0] : translatedInput;
        const translationSourceId = text?.metadata?.promptVariableTranslationOf;
        const translationSource = translationSourceId && index.incoming.get(text!.id)?.has(translationSourceId) ? index.byId.get(translationSourceId) : undefined;
        const original = translationSource || text;
        const prompt = original && isPreview(original) && !used.has(original.id) ? original : undefined;
        const sourceId = prompt?.metadata?.promptVariableSourceNodeId;
        const linkedSource = sourceId && index.incoming.get(prompt!.id)?.has(sourceId) ? index.byId.get(sourceId) : undefined;
        const source = linkedSource && linkedSource.type === "text" && valid(linkedSource) && !used.has(linkedSource.id)
            ? linkedSource : original && !isPreview(original) && !used.has(original.id) ? original : undefined;
        if (source) used.add(source.id);
        if (prompt) used.add(prompt.id);
        const outputs = [...(index.outgoing.get(config.id) || [])].map(id => index.byId.get(id)!).filter(node => {
            if (!isMedia(node) || !valid(node)) return false;
            const incoming = [...(index.incoming.get(node.id) || [])];
            return incoming.length === 1 && incoming[0] === config.id;
        });
        rows.push({ source, prompt, translations: [], config, orderNode: linkedSource || original || config, outputs: outputSlots(outputs, variantColumns) });
    }
    for (const source of nodes.filter(node => valid(node) && isPromptSource(node) && !isPreview(node) && !used.has(node.id))) {
        const prompt = [...(index.outgoing.get(source.id) || [])].map(id => index.byId.get(id)!).find(node =>
            isPreview(node) && valid(node) && !used.has(node.id) && node.metadata?.promptVariableSourceNodeId === source.id);
        used.add(source.id);
        if (prompt) used.add(prompt.id);
        rows.push({ source, prompt, translations: [], orderNode: source, outputs: new Map() });
    }
    rows.sort((a, b) => comparePrompt(a.orderNode, b.orderNode, nodeOrder));
    for (const row of rows) {
        const origins = [row.source, row.prompt].filter((node): node is CanvasNodeData => Boolean(node));
        const originIds = new Set(origins.map(node => node.id));
        row.translations = nodes.filter(node => {
            if (!isTranslationCandidate(node) || !valid(node) || used.has(node.id)) return false;
            const sourceId = node.metadata?.promptVariableTranslationOf;
            if (sourceId && originIds.has(sourceId)) return true;
            const incoming = [...(index.incoming.get(node.id) || [])].filter(id => index.byId.get(id)?.type === "text");
            return incoming.length === 1 && originIds.has(incoming[0]);
        })
            .sort((a, b) => compare.compare(String(a.metadata?.promptVariableTranslationLanguage || ""), String(b.metadata?.promptVariableTranslationLanguage || "")) || a.id.localeCompare(b.id));
        for (const node of row.translations) used.add(node.id);
    }
    const participants = new Set(rows.flatMap(row => [row.source?.id, row.prompt?.id, ...row.translations.map(node => node.id), row.config?.id, ...[...row.outputs.values()].map(node => node.id)].filter((id): id is string => Boolean(id))));
    const parameters = nodes.filter(node => isParameter(node) && valid(node) && [...(index.outgoing.get(node.id) || [])].some(id => participants.has(id))).sort(sorted);
    return { rows, parameters };
}

function columnPositions(rows: Row[], parameters: CanvasNodeData[], anchorX: number): Columns {
    const width = (items: (CanvasNodeData | undefined)[]) => Math.max(0, ...items.map(item => item?.width || 0));
    let x = anchorX;
    const take = (size: number) => { const left = x; if (size) x += size + 96; return left; };
    const parameter = take(width(parameters)), source = take(width(rows.map(row => row.source)));
    const prompt = take(width(rows.map(row => row.prompt)));
    const translations = rows.flatMap(row => row.translations);
    const translation = translations.length ? take(width(translations)) : undefined;
    const config = take(width(rows.map(row => row.config)));
    const outputWidths = new Map<number, number>();
    for (const row of rows) for (const [slot, node] of row.outputs) outputWidths.set(slot, Math.max(outputWidths.get(slot) || 0, node.width));
    const outputs = new Map<number, number>();
    const maxSlot = Math.max(0, ...outputWidths.keys());
    const defaultWidth = Math.max(0, ...outputWidths.values());
    // 极大的尾号不应制造数百个空列；普通编号仍为缺号预留位置。
    const slots = maxSlot <= 32 ? Array.from({ length: maxSlot }, (_, i) => i + 1) : [...outputWidths.keys()].sort((a, b) => a - b);
    for (const slot of slots) outputs.set(slot, take(outputWidths.get(slot) || defaultWidth));
    return { parameter, source, prompt, translation, config, outputs };
}

// 独立于生成配置的普通流程也按实际连线分层；环中的节点以稳定顺序排列。
function extraFlows(extras: CanvasNodeData[], index: ReturnType<typeof connectionIndex>) {
    const ids = new Set(extras.map(node => node.id));
    const neighbors = (id: string) => [...new Set([
        ...(index.incoming.get(id) || []), ...(index.outgoing.get(id) || []),
    ])].filter(other => ids.has(other));
    const remaining = new Set(ids);
    const components: CanvasNodeData[][] = [];
    for (const start of [...extras].sort((a, b) => a.type === "text" && b.type === "text" ? comparePrompt(a, b) : sorted(a, b))) {
        if (!remaining.delete(start.id)) continue;
        const queue = [start.id], component: CanvasNodeData[] = [];
        for (let i = 0; i < queue.length; i++) {
            const id = queue[i];
            component.push(index.byId.get(id)!);
            for (const next of neighbors(id)) if (remaining.delete(next)) queue.push(next);
        }
        components.push(component.sort(sorted));
    }
    return components.map(component => {
        const members = new Set(component.map(node => node.id));
        const levels = new Map<string, number>();
        const pending = new Set(members);
        while (pending.size) {
            const ready = component.filter(node => pending.has(node.id)
                && [...(index.incoming.get(node.id) || [])].every(id => !pending.has(id) || !members.has(id)));
            // 循环无法拓扑排序时选择一个稳定入口，仍然保留所有卡片。
            const batch = ready.length ? ready : [component.find(node => pending.has(node.id))!];
            for (const node of batch) {
                const parents = [...(index.incoming.get(node.id) || [])].filter(id => levels.has(id));
                levels.set(node.id, parents.length ? Math.max(...parents.map(id => levels.get(id)! + 1)) : 0);
                pending.delete(node.id);
            }
        }
        const layers: CanvasNodeData[][] = [];
        for (const node of component) (layers[levels.get(node.id)!] ||= []).push(node);
        return layers.map(layer => layer.sort(sorted));
    });
}

/** 根据真实连线规划流程列和结果编号列，其余卡片按类型单独归列。 */
export function layoutCanvas(nodes: CanvasNodeData[], connections: CanvasConnection[], selectedIds?: ReadonlySet<string>): CanvasNodeData[] {
    if (!nodes.length || (selectedIds && !selectedIds.size)) return nodes;
    const normalized = uniformVariantResultWidths(nodes, selectedIds);
    if (normalized.some((node, index) => node !== nodes[index])) nodes = normalized;
    if (selectedIds) {
        const selected = nodes.filter(node => node.type !== "group" && valid(node) && selectedIds.has(node.id)
            && (!node.metadata?.groupId || selectedIds.has(node.metadata.groupId)));
        if (!selected.length) return nodes;
        const planned = layoutCanvas(selected, connections);
        const fixed = nodes.filter(node => node.type !== "group" && valid(node) && !selected.includes(node));
        const anchorX = Math.min(...selected.map(node => node.position.x));
        const anchorY = Math.min(...selected.map(node => node.position.y));
        const dx = anchorX - Math.min(...planned.map(node => node.position.x));
        let dy = anchorY - Math.min(...planned.map(node => node.position.y));
        // 选中节点整体平移，允许彼此交换原位置，同时绕开所有未选卡片。
        for (let attempt = 0; attempt <= fixed.length; attempt++) {
            const collisions = planned.flatMap(node => fixed.filter(obstacle => nodesOverlap({ ...node, position: { x: node.position.x + dx, y: node.position.y + dy } }, obstacle, NODE_PLACEMENT_GAP)));
            if (!collisions.length) break;
            dy = Math.max(dy, ...collisions.map(obstacle => obstacle.position.y + obstacle.height + NODE_PLACEMENT_GAP - Math.min(...planned.map(node => node.position.y))));
        }
        const positions = new Map(planned.map(node => [node.id, { x: node.position.x + dx, y: node.position.y + dy }]));
        const result = nodes.map(node => {
            const position = positions.get(node.id);
            return position && (position.x !== node.position.x || position.y !== node.position.y) ? { ...node, position } : node;
        });
        const moved = new Set(result.filter((node, i) => node !== nodes[i]).map(node => node.id));
        return moved.size ? expandChangedGroups(result, moved) : nodes;
    }
    const index = connectionIndex(nodes, connections);
    const { rows, parameters } = collectRows(nodes, index);
    const flowNodes = [...parameters, ...rows.flatMap(row => [row.source, row.prompt, ...row.translations, row.config, ...row.outputs.values()].filter((node): node is CanvasNodeData => Boolean(node)))];
    const flowIds = new Set(flowNodes.map(node => node.id));
    const dependents = new Map<string, CanvasNodeData[]>();
    const mergeInputs = new Map<string, CanvasNodeData[]>();
    const mergeInputIds = new Set<string>();
    const mediaParents = nodes.filter(node => isMedia(node) && valid(node)).sort((a, b) =>
        Number(flowIds.has(b.id)) - Number(flowIds.has(a.id)) || a.id.localeCompare(b.id));
    const configOwners = new Map<string, string>();
    for (const config of nodes.filter(node => node.type === "config" && !flowIds.has(node.id))) {
        const inputs = [...(index.incoming.get(config.id) || [])].map(id => index.byId.get(id)!)
            .filter(node => isMedia(node) && valid(node));
        if (!inputs.some(node => Boolean(node.metadata?.generationType || node.metadata?.generationNameBase || node.metadata?.generationStartedAt))) continue;
        const primary = inputs.find(node => flowIds.has(node.id))
            || inputs.find(node => Boolean(index.incoming.get(node.id)?.size))
            || inputs.sort((a, b) => a.id.localeCompare(b.id))[0];
        if (primary) configOwners.set(config.id, primary.id);
    }
    const sortDependents = (a: CanvasNodeData, b: CanvasNodeData) => Number(a.type === "config") - Number(b.type === "config")
        || compare.compare(a.title || "", b.title || "") || a.id.localeCompare(b.id);
    for (const parent of mediaParents) {
        const children = [...(index.outgoing.get(parent.id) || [])].map(id => index.byId.get(id)!).filter(node =>
            valid(node) && !flowIds.has(node.id) && (isMedia(node) || (node.type === "config"
                && (!configOwners.has(node.id) || configOwners.get(node.id) === parent.id))));
        if (children.length) dependents.set(parent.id, children.sort(sortDependents));
    }
    const branchInputIds = new Set<string>();
    for (const config of nodes.filter(node => node.type === "config" && !flowIds.has(node.id))) {
        const inputs = [...(index.incoming.get(config.id) || [])].map(id => index.byId.get(id)!).filter(node =>
            valid(node) && (isMedia(node) || node.type === "text"));
        if (!inputs.some(node => isMedia(node) && Boolean(node.metadata?.generationType || node.metadata?.generationImageType || node.metadata?.generationNameBase))) continue;
        if (inputs.length < 2) continue;
        const roots = inputs.filter(node => !index.incoming.get(node.id)?.size && index.outgoing.get(node.id)?.size === 1);
        // 再生通常是已有结果加一个批注支路；多个无关根节点或共享参考图不能误判为汇入组。
        if (roots.length !== 1 || roots[0].type !== "text") continue;
        mergeInputs.set(config.id, inputs);
        for (const input of inputs) mergeInputIds.add(input.id);
        for (const root of roots) branchInputIds.add(root.id);
    }
    for (const config of nodes.filter(node => node.type === "config" && !flowIds.has(node.id))) {
        const children = [...(index.outgoing.get(config.id) || [])].map(id => index.byId.get(id)!).filter(node =>
            isMedia(node) && valid(node) && !flowIds.has(node.id) && index.incoming.get(node.id)?.size === 1);
        if (children.length) dependents.set(config.id, children.sort(sortDependents));
    }
    for (const parent of mediaParents.filter(node => flowIds.has(node.id))) {
        for (const child of dependents.get(parent.id) || []) {
            const companions = [...(index.incoming.get(child.id) || [])].map(id => index.byId.get(id)!).filter(node =>
                node.id !== parent.id && (isMedia(node) || node.type === "text") && valid(node) && !flowIds.has(node.id)
                && !index.incoming.get(node.id)?.size && index.outgoing.get(node.id)?.size === 1);
            const siblings = dependents.get(parent.id)!;
            for (const companion of companions) if (!siblings.some(node => node.id === companion.id)) siblings.push(companion);
            siblings.sort(sortDependents);
        }
    }
    for (const config of nodes.filter(node => node.type === "config" && !flowIds.has(node.id))) {
        const inputs = [...(index.incoming.get(config.id) || [])].map(id => index.byId.get(id)!).filter(node => valid(node));
        if (!inputs.some(node => branchInputIds.has(node.id))) continue;
        for (const input of inputs) {
            const children = dependents.get(input.id) || [];
            if (!children.some(node => node.id === config.id)) children.push(config);
            children.sort(sortDependents);
            dependents.set(input.id, children);
        }
    }
    const dependentIds = new Set([...dependents.values()].flat().map(node => node.id));
    const extras = nodes.filter(node => node.type !== "group" && valid(node) && !flowIds.has(node.id));
    const upstream = extras.filter(node => !dependentIds.has(node.id) && !(index.incoming.get(node.id)?.size)
        && [...(index.outgoing.get(node.id) || [])].some(id => flowIds.has(id)));
    const references = parameters.length ? upstream.filter(isMedia) : [];
    const referenceIds = new Set(references.map(node => node.id));
    const otherUpstream = upstream.filter(node => !referenceIds.has(node.id));
    const upstreamIds = new Set(upstream.map(node => node.id));
    const otherExtras = extras.filter(node => !upstreamIds.has(node.id) && !dependentIds.has(node.id));
    const participants = [...flowNodes, ...extras];
    if (!participants.length) return nodes;
    const movable = new Set(participants.map(node => node.id));
    if (!movable.size) return nodes;
    const anchorX = Math.min(...participants.map(node => node.position.x));
    const upstreamWidth = otherUpstream.length ? Math.max(...otherUpstream.map(node => node.width)) + 96 : 0;
    const parameterWidth = Math.max(0, ...parameters.map(node => node.width), ...references.map(node => node.width));
    const columns = columnPositions(rows, parameters, anchorX + upstreamWidth);
    if (parameterWidth > Math.max(0, ...parameters.map(node => node.width))) {
        const delta = parameterWidth - Math.max(0, ...parameters.map(node => node.width));
        columns.source += delta; columns.prompt += delta;
        if (columns.translation !== undefined) columns.translation += delta;
        columns.config += delta;
        for (const [slot, x] of columns.outputs) columns.outputs.set(slot, x + delta);
    }
    const rowMembers = (row: Row) => [row.source, row.prompt, ...row.translations, row.config, ...row.outputs.values()].filter((node): node is CanvasNodeData => Boolean(node));
    const rowHeights = rows.map(row => Math.max(...rowMembers(row).map(node => node.height)));
    const primaryTranslation = (row: Row) => row.translations.find(node => row.config && index.incoming.get(row.config.id)?.has(node.id))
        || row.translations[0];
    const rowBranchTranslations = (row: Row) => row.translations.filter(node => node.id !== primaryTranslation(row)?.id);
    const anchors = [...flowNodes, ...upstream];
    const topY = Math.min(...(anchors.length ? anchors : participants.filter(node => !dependentIds.has(node.id))).map(node => node.position.y));
    let nextY = rows.length ? Math.min(...rows.flatMap(row => rowMembers(row).map(node => node.position.y))) : topY;
    const mainIndex = rows.findIndex(row => promptOrder(row.orderNode).rank === 0);
    const referenceHeight = references.reduce((sum, node) => sum + node.height + NODE_PLACEMENT_GAP, 0);
    if (mainIndex === 0 && parameters.length) {
        nextY = Math.max(nextY, topY + referenceHeight + parameters[0].height / 2 - rowHeights[0] / 2);
    }
    const plan = planWorkflowRows(rows.map(row => ({
        members: rowMembers(row),
        rank: promptOrder(row.orderNode).rank,
        branchRoots: [...row.outputs.values()],
        extraHeight: rowBranchTranslations(row).reduce((sum, node) => sum + node.height + NODE_PLACEMENT_GAP, 0),
    })), dependents, nextY);
    const centers = plan.centers;
    const proposed = new Map<string, Position>();
    const add = (node: CanvasNodeData | undefined, x: number, y: number) => {
        if (node && movable.has(node.id)) proposed.set(node.id, { x, y: y - node.height / 2 });
    };
    rows.forEach((row, i) => {
        add(row.source, columns.source, centers[i]); add(row.prompt, columns.prompt, centers[i]);
        const translationX = columns.translation ?? columns.config;
        const mainTranslation = primaryTranslation(row);
        if (mainTranslation) add(mainTranslation, translationX, centers[i]);
        const branches = rowBranchTranslations(row);
        add(row.config, columns.config, centers[i]);
        for (const [slot, output] of row.outputs) add(output, columns.outputs.get(slot)!, centers[i]);
        let branchY = centers[i] + rowHeights[i] / 2 + NODE_PLACEMENT_GAP;
        for (const node of branches) {
            add(node, translationX, branchY + node.height / 2);
            branchY += node.height + NODE_PLACEMENT_GAP;
        }
    });
    const middle = mainIndex >= 0 ? centers[mainIndex] : centers.length ? centers[0] : topY;
    let parameterBottom = Number.NEGATIVE_INFINITY;
    for (const parameter of parameters) {
        const y = Math.max(middle - parameter.height / 2, parameterBottom + NODE_PLACEMENT_GAP);
        add(parameter, columns.parameter, y + parameter.height / 2);
        parameterBottom = y + parameter.height;
    }

    let referenceBottom = parameters.length ? middle - parameters[0].height / 2 - NODE_PLACEMENT_GAP : topY;
    for (const node of [...references].sort(sorted).reverse()) {
        add(node, columns.parameter, referenceBottom - node.height / 2);
        referenceBottom -= node.height + NODE_PLACEMENT_GAP;
    }
    let upstreamY = topY;
    for (const node of [...otherUpstream].sort(sorted)) {
        add(node, anchorX, upstreamY + node.height / 2);
        upstreamY += node.height + NODE_PLACEMENT_GAP;
    }

    const flows = extraFlows(otherExtras, index);
    const extraX = Math.max(Math.min(...participants.map(node => node.position.x)),
        ...flowNodes.map(node => (proposed.get(node.id)?.x ?? node.position.x) + node.width + 96));
    const widths: number[] = [];
    for (const flow of flows) for (const [level, layer] of flow.entries()) {
        widths[level] = Math.max(widths[level] || 0, ...layer.map(node => node.width));
    }
    const positions: number[] = [];
    for (let level = 0, x = extraX; level < widths.length; level++) {
        positions[level] = x;
        x += widths[level] + 96;
    }
    let flowTop = topY;
    for (const flow of flows) {
        const layerHeight = (layer: CanvasNodeData[]) => layer.reduce((sum, node) => sum + node.height, 0)
            + Math.max(0, layer.length - 1) * NODE_PLACEMENT_GAP;
        const height = Math.max(...flow.map(layerHeight));
        for (const [level, layer] of flow.entries()) {
            let y = flowTop + (height - layerHeight(layer)) / 2;
            for (const node of layer) {
                add(node, positions[level], y + node.height / 2);
                y += node.height + NODE_PLACEMENT_GAP;
            }
        }
        flowTop += height + NODE_PLACEMENT_GAP;
    }

    // 图片的后续配置和再生成结果沿真实关系靠近来源，避免散落在画布末尾。
    const remaining = new Set(dependentIds);
    while (remaining.size) {
        let progress = false;
        for (const [parentId, children] of dependents) {
            const parent = index.byId.get(parentId)!;
            const parentPosition = proposed.get(parentId);
            if (!parentPosition) continue;
            for (const child of children) {
                if (!remaining.has(child.id)) continue;
                const occupied = participants.filter(node => node.id !== child.id && proposed.has(node.id))
                    .map(node => ({ ...node, position: proposed.get(node.id)! }));
                const inputRight = child.type === "config"
                    ? [...(index.incoming.get(child.id) || [])].map(id => {
                        const input = index.byId.get(id), position = proposed.get(id);
                        return input && position ? position.x + input.width : Number.NEGATIVE_INFINITY;
                    })
                    : [];
                const merge = child.type === "config" ? mergeInputs.get(child.id) : undefined;
                const mergePositions = merge?.flatMap(input => {
                    const position = proposed.get(input.id);
                    return position ? [{ node: input, position }] : [];
                }) || [];
                // 等所有真实输入完成定位后再放置汇入配置，避免先按单一父节点占位。
                if (merge && mergePositions.length !== merge.length) continue;
                const mergeLeft = Math.min(...mergePositions.map(item => item.position.x));
                const mergeRight = Math.max(...mergePositions.map(item => item.position.x + item.node.width));
                const desiredX = merge && mergePositions.length === merge.length
                    ? (mergeLeft + mergeRight - child.width) / 2
                    : Math.max(parentPosition.x + parent.width, ...inputRight) + 96;
                const owner = plan.owner.get(child.id);
                const bounds = owner === undefined ? undefined : plan.branchBounds[owner];
                const parentInBranch = owner !== undefined && plan.owner.get(parentId) === owner;
                const mergeBottom = Math.max(...mergePositions.map(item => item.position.y + item.node.height));
                const outputOfMerge = parent.type === "config" && mergeInputs.has(parent.id);
                const desiredY = outputOfMerge
                    ? parentPosition.y + (parent.height - child.height) / 2
                    : merge && mergePositions.length === merge.length
                    ? mergeBottom + NODE_PLACEMENT_GAP
                    : mergeInputIds.has(child.id)
                        ? parentPosition.y + (parent.height - child.height) / 2
                        : bounds && !parentInBranch
                            ? bounds.top + (bounds.rowHeight - child.height) / 2
                            : parentPosition.y + (parent.height - child.height) / 2;
                // 再生/遮罩链是原图的局部流程。优先在来源右侧上下寻找空位，
                // 只有局部空间确实不足时才逐列外扩，避免被全局结果列推到画布远端。
                const localStep = Math.max(child.height, parent.height) + NODE_PLACEMENT_GAP;
                const localYs = Array.from({ length: 9 }, (_, index) => {
                    const offset = index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? 1 : -1);
                    return desiredY + offset * localStep;
                });
                const localXs = [desiredX, desiredX + child.width + NODE_PLACEMENT_GAP,
                    desiredX + 2 * (child.width + NODE_PLACEMENT_GAP)];
                const fallbackXs = occupied.map(node => node.position.x + node.width + NODE_PLACEMENT_GAP)
                    .filter(x => x > desiredX).sort((a, b) => a - b);
                const xs = [...new Set([...localXs, ...fallbackXs])].sort((a, b) => a - b);
                const ys = [...new Set([...(bounds ? [bounds.top] : []), ...localYs, ...occupied.flatMap(node => [
                    node.position.y + node.height + NODE_PLACEMENT_GAP,
                    node.position.y - child.height - NODE_PLACEMENT_GAP,
                ])])];
                let best: Position | undefined;
                let score = Number.POSITIVE_INFINITY;
                for (const x of xs) for (const y of ys) {
                    if (bounds && !mergeInputIds.has(child.id) && !outputOfMerge
                        && (y < bounds.top || y + child.height > bounds.bottom)) continue;
                    const distance = parentInBranch
                        ? (x - desiredX) * 4 + Math.abs(y - desiredY)
                        : x - desiredX + Math.abs(y - desiredY) * 3;
                    if (distance >= score || occupied.some(node => nodesOverlap({ ...child, position: { x, y } }, node, NODE_PLACEMENT_GAP))) continue;
                    best = { x, y }; score = distance;
                }
                if (!best) continue;
                proposed.set(child.id, best);
                remaining.delete(child.id);
                progress = true;
            }
        }
        if (!progress) break;
    }
    // 断裂或循环关系保留卡片，不凭名称创建连接。
    // 无法规划的关系保留原位置，作为固定障碍避免与其他卡片重叠。

    const fixed = nodes.filter(node => node.type !== "group" && valid(node) && !proposed.has(node.id));
    const moving = participants.filter(node => proposed.has(node.id));
    let shift = 0;
    for (let attempt = 0; attempt <= fixed.length; attempt++) {
        const collisions = moving.flatMap(node => fixed.filter(obstacle => nodesOverlap({ ...node, position: { ...proposed.get(node.id)!, y: proposed.get(node.id)!.y + shift } }, obstacle, NODE_PLACEMENT_GAP)));
        if (!collisions.length) break;
        shift = Math.max(shift, ...collisions.map(obstacle => obstacle.position.y + obstacle.height + NODE_PLACEMENT_GAP - Math.min(...moving.map(node => proposed.get(node.id)!.y))));
    }
    if (shift) for (const position of proposed.values()) position.y += shift;
    const result = nodes.map(node => {
        const position = proposed.get(node.id);
        return position && (Math.abs(position.x - node.position.x) > 1e-7 || Math.abs(position.y - node.position.y) > 1e-7) ? { ...node, position } : node;
    });
    const moved = new Set(result.filter((node, i) => node !== nodes[i]).map(node => node.id));
    if (!moved.size) return nodes;
    return expandChangedGroups(result, moved);
}
