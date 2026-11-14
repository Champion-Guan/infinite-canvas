import { useEffect } from "react";
import { useThemeStore } from "./三态主题状态";

// 接入时仍生成历史模块路径；只挂载一份监听，不提供手动选择控件。
export function SystemThemeSync() {
    useEffect(() => {
        if (typeof window.matchMedia !== "function") return;
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const sync = () => useThemeStore.getState().syncSystemTheme(media.matches);
        sync();
        media.addEventListener("change", sync);
        return () => media.removeEventListener("change", sync);
    }, []);
    return null;
}
