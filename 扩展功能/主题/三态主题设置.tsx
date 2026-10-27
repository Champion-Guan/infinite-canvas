import { useEffect } from "react";
import { useThemeStore } from "./三态主题状态";

// 只挂载一份监听；画布外观中的按钮可以恢复跟随系统。
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
