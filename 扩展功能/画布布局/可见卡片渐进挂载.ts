import { useEffect, useRef, useState } from "react";
import type { CanvasNodeData } from "@/types/canvas";

// 新进入视区的卡片在手势后分帧挂载；已加载卡片随画布驻留，
// 由既有五分钟空闲机制统一释放，不因短暂移出视区重建。
export function useProgressiveCanvasNodes(nodes: CanvasNodeData[], interacting: boolean) {
    const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set());
    const current = useRef(mounted);
    const latest = useRef(nodes);
    latest.current = nodes;
    const signature = nodes.map(node => node.id).join("\0");
    useEffect(() => {
        if (interacting) return;
        let active = true, frame = 0;
        const ready = new Set(current.current);
        const waiting = latest.current.filter(node => !ready.has(node.id));
        let cursor = 0;
        const mount = () => {
            if (!active) return;
            let cost = 0;
            while (cursor < waiting.length && cost < 4) {
                const node = waiting[cursor++];
                ready.add(node.id);
                cost += node.type === "image" ? 1 : 4;
            }
            const next = new Set(ready);
            current.current = next; setMounted(next);
            if (cursor < waiting.length) frame = requestAnimationFrame(mount);
        };
        if (waiting.length) frame = requestAnimationFrame(mount);
        return () => { active = false; cancelAnimationFrame(frame); };
    }, [signature, interacting]);
    return mounted;
}
