import { lazy, Suspense, useState } from "react";
import { useConfigStore } from "@/stores/use-config-store";

let loading: Promise<{ default: typeof import("@/components/layout/app-config-modal").AppConfigModal }> | null = null;
const loadSettings = () => loading ??= import("@/components/layout/app-config-modal")
    .then(module => ({ default: module.AppConfigModal })).catch(error => { loading = null; throw error; });
export function preloadSettings() { void loadSettings().catch(() => {}); }
const Settings = lazy(loadSettings);

export function DeferredSettings() {
    const open = useConfigStore(state => state.isConfigOpen);
    const [activated, setActivated] = useState(open);
    if (open && !activated) setActivated(true);
    // 首次打开后保留原弹窗实例，关闭仍由原组件完成退场及焦点恢复。
    return activated || open ? <Suspense fallback={null}><Settings /></Suspense> : null;
}
