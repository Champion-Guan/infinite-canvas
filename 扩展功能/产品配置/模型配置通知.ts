export type MissingModelNotice = { sequence: number; message: string };
let current: MissingModelNotice | null = null;
let sequence = 0;
let lastShownAt = 0;
const listeners = new Set<() => void>();

export const missingModelNoticeSnapshot = () => current;
export const subscribeMissingModelNotice = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
export function publishMissingModelNotice(message: string) {
    const now = Date.now();
    if (current?.message === message && now - lastShownAt < 750) return;
    lastShownAt = now;
    current = { sequence: ++sequence, message };
    for (const listener of listeners) listener();
}
