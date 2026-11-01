import type { CanvasNodeData } from "@/types/canvas";

type WorkflowRow = {
    members: CanvasNodeData[];
    rank: number;
    branchRoots: CanvasNodeData[];
    extraHeight?: number;
};

type BranchBounds = { top: number; bottom: number; rowHeight: number };

const CARD_GAP = 48;
const FLOW_GAP = 96;
const CATEGORY_GAP = 144;

/** 为每条真实的后续关系分配所属流程，并提前预留支路空间。 */
export function planWorkflowRows(rows: WorkflowRow[], dependents: ReadonlyMap<string, CanvasNodeData[]>, startY: number) {
    const owner = new Map<string, number>();
    const mainIds = new Set(rows.flatMap(row => row.members.map(node => node.id)));
    const branches: CanvasNodeData[][] = rows.map(() => []);
    for (const [index, row] of rows.entries()) {
        const queue = row.branchRoots.map(node => node.id);
        const visited = new Set(queue);
        for (let cursor = 0; cursor < queue.length; cursor++) {
            for (const child of dependents.get(queue[cursor]) || []) {
                if (mainIds.has(child.id) || owner.has(child.id) || visited.has(child.id)) continue;
                visited.add(child.id);
                owner.set(child.id, index);
                branches[index].push(child);
                queue.push(child.id);
            }
        }
    }

    const centers: number[] = [];
    const branchBounds: (BranchBounds | undefined)[] = [];
    let top = startY;
    for (const [index, row] of rows.entries()) {
        const height = Math.max(0, ...row.members.map(node => node.height));
        centers.push(top + height / 2);
        const branchTop = top + height + Math.max(0, row.extraHeight || 0) + CARD_GAP;
        const children = branches[index];
        const branchHeight = children.reduce((sum, node) => sum + node.height, 0)
            + Math.max(0, children.length - 1) * CARD_GAP;
        branchBounds.push(children.length ? { top: branchTop, bottom: branchTop + branchHeight,
            rowHeight: Math.max(...children.map(node => node.height)) } : undefined);
        const bottom = children.length ? branchTop + branchHeight : top + height + Math.max(0, row.extraHeight || 0);
        const next = rows[index + 1];
        top = bottom + (next && next.rank !== row.rank ? CATEGORY_GAP : FLOW_GAP);
    }
    return { centers, branchBounds, owner };
}
