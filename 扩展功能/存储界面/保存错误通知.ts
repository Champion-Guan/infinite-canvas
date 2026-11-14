let failure = "";
const listeners = new Set<() => void>();
export const readReportedSaveFailure = () => failure;
export function reportSaveFailure(message: string) {
    failure = message;
    for (const listener of listeners) listener();
}
export function clearReportedSaveFailure() {
    if (!failure) return;
    failure = "";
    for (const listener of listeners) listener();
}
export function subscribeReportedSaveFailure(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
