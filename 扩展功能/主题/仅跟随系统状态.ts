import { create } from "zustand";

export type ThemeName = "light" | "dark";
// 保留旧接口类型，避免要求上游所有消费组件一起修改。
export type ThemeMode = ThemeName | "system";
type ThemeStore = {
    theme: ThemeName;
    mode: ThemeMode;
    setTheme: (theme: ThemeName) => void;
    setMode: (mode: ThemeMode) => void;
    syncSystemTheme: (dark: boolean) => void;
};

export function systemTheme(): ThemeName {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// 只解析系统外观，不读取或覆盖旧的手动主题持久化记录。
// 兼容setter不再改变主题；所有仍保留的上游消费者读取同一个解析结果。
export const useThemeStore = create<ThemeStore>()((set, get) => ({
    mode: "system",
    theme: systemTheme(),
    setTheme: () => undefined,
    setMode: () => undefined,
    syncSystemTheme: (dark) => {
        const theme = dark ? "dark" : "light";
        if (get().theme !== theme) set({ theme });
    },
}));
