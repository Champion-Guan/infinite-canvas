import { useSyncExternalStore } from "react";
import { globalPlatformRules } from "./平台规则全局状态";

export function useGlobalPlatformRules() {
    return useSyncExternalStore(globalPlatformRules.subscribe, globalPlatformRules.getSnapshot, globalPlatformRules.getSnapshot);
}
