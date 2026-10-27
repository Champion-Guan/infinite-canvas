import { useSyncExternalStore } from "react";
import type { AiConfig, ModelCapability } from "@/stores/use-config-store";
import { enabledEntries, reconcileFallback, FALLBACK_MODEL_OPTION, FALLBACK_CHANGED_EVENT } from "./原版策略.mjs";

export { FALLBACK_MODEL_OPTION, FALLBACK_CHANGED_EVENT };
export type FallbackConfig = { enabled: boolean; capabilities: Record<ModelCapability, { enabled: boolean; modelOrder?: string[]; entries: Array<{ profileId: string; modelName: string; enabled: boolean }> }> };
export type FallbackSnapshot = { revision: number; value: FallbackConfig };
export type FallbackHost = {
    read(): Promise<FallbackSnapshot>; snapshot(): FallbackSnapshot;
    save(value: FallbackConfig, revision: number): Promise<FallbackSnapshot>;
    subscribe(listener: () => void): () => void;
};
export function fallbackHost(): FallbackHost {
    const host = (window as unknown as { __guanFallbackHost?: FallbackHost }).__guanFallbackHost;
    if (!host) throw new Error("本机Fallback端口尚未接入；未回退浏览器存储。");
    return host;
}
export function fallbackModelsByCapability(config: AiConfig, capability: ModelCapability): string[] {
    const state = reconcileFallback(fallbackHost().snapshot().value, config.channels);
    return enabledEntries(state, capability).map((entry: { profileId: string; modelName: string }) => `${entry.profileId}::${entry.modelName}`);
}
export function hasEnabledFallback(capability: ModelCapability, config: AiConfig) { return fallbackModelsByCapability(config, capability).length > 0; }
export function resolveFallbackModel(config: AiConfig, capability: ModelCapability) { return fallbackModelsByCapability(config, capability)[0] || ""; }
const subscribe = (listener: () => void) => fallbackHost().subscribe(listener);
const snapshot = () => fallbackHost().snapshot().revision;
export function useFallbackRevision() { return useSyncExternalStore(subscribe, snapshot, () => 0); }
