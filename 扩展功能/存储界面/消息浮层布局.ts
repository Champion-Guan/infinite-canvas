import { useSyncExternalStore } from "react";

export const PERSISTENT_MESSAGE_TOP = 92;
const heights = new Map<string, { token: symbol; height: number }>();
const listeners = new Set<() => void>();
const snapshot = () => PERSISTENT_MESSAGE_TOP + (heights.size ? Math.max(...[...heights.values()].map(item => item.height)) + 8 : 0);
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function reservePersistentMessage(key: string) {
    const token = Symbol(key);
    const notify = (before: number) => { if (snapshot() !== before) for (const listener of listeners) listener(); };
    return {
        resize(height: number) {
            const before = snapshot();
            heights.set(key, { token, height: Math.max(0, Math.ceil(height)) });
            notify(before);
        },
        release() {
            if (heights.get(key)?.token !== token) return;
            const before = snapshot();
            heights.delete(key);
            notify(before);
        },
    };
}

export const transientMessageTop = snapshot;
export const useTransientMessageTop = () => useSyncExternalStore(subscribe, snapshot, () => PERSISTENT_MESSAGE_TOP);
