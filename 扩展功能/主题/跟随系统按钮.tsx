import { Monitor } from "lucide-react";
import { useThemeStore } from "./三态主题状态";

export function SystemThemeButton() {
    const mode = useThemeStore(state => state.mode);
    return <button type="button" aria-label="跟随系统主题" aria-pressed={mode === "system"}
        className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-sm hover:bg-black/5 dark:hover:bg-white/10"
        style={mode === "system" ? { background: "var(--color-accent)", fontWeight: 600 } : undefined}
        onClick={() => useThemeStore.getState().setMode("system")}>
        <Monitor className="size-4" />跟随系统
    </button>;
}
