import type { CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export type ProductPlanningTask = { id: string; startedAt: number; status: "loading" | "success" | "error" | "idle"; productId?: string; nodeId?: string };
type PlanningMetadata = CanvasNodeMetadata & { productPlanningTask?: ProductPlanningTask };

export async function runProductPlanningTask<T>(ctx: CanvasNodeContext, signal: AbortSignal, work: () => Promise<T>, productId?: string): Promise<T> {
    signal.throwIfAborted();
    const task: ProductPlanningTask = { id: crypto.randomUUID(), startedAt: Date.now(), status: "loading",
        ...(productId ? { productId, nodeId: ctx.node.id } : {}) };
    const current = () => ctx.getNode(ctx.node.id);
    if (!current()) throw Error("产品参数卡已移除。");
    ctx.updateMetadata({ productPlanningTask: task } as PlanningMetadata);
    const settle = (status: ProductPlanningTask["status"]) => {
        const value = (current()?.metadata as PlanningMetadata | undefined)?.productPlanningTask;
        if (value?.id === task.id && value.status !== status)
            ctx.updateMetadata({ productPlanningTask: { ...task, status } } as PlanningMetadata);
    };
    const cancel = () => settle("idle");
    signal.addEventListener("abort", cancel, { once: true });
    try {
        const result = await work();
        signal.throwIfAborted();
        // The workflow returns only after its result and recovery markers have
        // been saved; format repair and intermediate receipts are still loading.
        settle("success");
        return result;
    } catch (error) {
        settle(signal.aborted ? "idle" : "error");
        throw error;
    } finally { signal.removeEventListener("abort", cancel); }
}
