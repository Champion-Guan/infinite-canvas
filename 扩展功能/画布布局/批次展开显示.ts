import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useReducedMotion } from "motion/react";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { batchExpansionBox, batchExpansionOffsets, displayBatchNodes, revealBatchExpansion } from "./批次展开避让";
import { readCanvasFloatingBounds } from "../画布交互/浮层可见区域";
import { createBatchDisplacementPlayer } from "./批次避让过渡";

export function useBatchExpansionDisplay(nodes: CanvasNodeData[], expanded: ReadonlySet<string>, active: boolean,
    container: RefObject<HTMLDivElement | null>, viewport: RefObject<ViewportTransform>, moveViewport: (next: ViewportTransform) => void) {
    const signature = JSON.stringify([ [...expanded], nodes.map(node => [node.id, node.type, node.width, node.height, node.metadata?.groupId,
        expanded.has(node.id) ? [node.metadata?.images?.length, node.metadata?.texts?.length] : null]) ]);
    const cache = useRef<{ signature: string; offsets: ReturnType<typeof batchExpansionOffsets> }>({ signature: "", offsets: new Map() });
    const offsets = useMemo(() => {
        // 用户拖动时保留本次避让偏移；只有展开集合或卡片结构变化才重排，不追着指针重新避让。
        if (cache.current.signature !== signature) cache.current = { signature, offsets: batchExpansionOffsets(nodes, expanded) };
        return cache.current.offsets;
    }, [nodes, signature, expanded]);
    const [painted, setPainted] = useState(new Map<string, { x: number; y: number }>());
    const player = useRef<ReturnType<typeof createBatchDisplacementPlayer> | null>(null);
    if (!player.current) player.current = createBatchDisplacementPlayer({
        frame: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id), now: () => performance.now(), write: setPainted,
    });
    const reduced = useReducedMotion();
    useLayoutEffect(() => { player.current!.move(offsets, !active || Boolean(reduced)); }, [offsets, active, reduced]);
    useEffect(() => () => player.current?.stop(), []);
    const displayNodes = useMemo(() => displayBatchNodes(nodes, painted), [nodes, painted]);
    const targets = useMemo(() => displayBatchNodes(nodes, offsets), [nodes, offsets]);
    const latest = useRef({ displayNodes: targets, expanded, moveViewport }); latest.current = { displayNodes: targets, expanded, moveViewport };
    const previous = useRef(new Set<string>());
    useEffect(() => {
        const opened = [...expanded].filter(id => !previous.current.has(id));
        previous.current = new Set(expanded);
        if (!active || !opened.length || !container.current) return;
        const root = container.current, id = opened.at(-1)!;
        const node = latest.current.displayNodes.find(node => node.id === id);
        if (!node) return;
        const next = revealBatchExpansion(viewport.current, batchExpansionBox(node, true), root.getBoundingClientRect(), readCanvasFloatingBounds(root), batchExpansionBox(node, false));
        if (next.x !== viewport.current.x || next.y !== viewport.current.y) latest.current.moveViewport(next);
    }, [expanded, active, container, viewport]);
    return displayNodes;
}
