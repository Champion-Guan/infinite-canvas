export type ProductPlanningNotice = { productId: string; parameterId: string; deadline: number | null; sequence: number };
const listeners = new Set<(notice: ProductPlanningNotice) => void>();
let sequence = 0;

export function subscribeProductPlanningNotice(listener: (notice: ProductPlanningNotice) => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function notifyProductPlanning(productId: string, parameterId: string, completed: boolean) {
    const notice = { productId, parameterId, deadline: completed ? Date.now() + 60_000 : null, sequence: ++sequence };
    for (const listener of listeners) listener(notice);
}

export const planningNoticeSeconds = (deadline: number) => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
