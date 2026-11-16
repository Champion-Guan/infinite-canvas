export type ProductImportProgress = {
    name: string; phase: string; completed: number; total: number; percent: number;
    status: "running" | "success" | "error"; error?: string;
};
let current: ProductImportProgress | null = null;
const listeners = new Set<() => void>();
export const importProgressSnapshot = () => current;
export const subscribeImportProgress = (listener: () => void) => {
    listeners.add(listener); return () => { listeners.delete(listener); };
};
export function publishImportProgress(value: ProductImportProgress | null) {
    current = value; for (const listener of listeners) listener();
}
