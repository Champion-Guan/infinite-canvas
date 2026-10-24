import { sqliteStateStorage } from "../本机存储/上游浏览器存储桥";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";
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

export function resolveThemeMode(saved: unknown): ThemeMode {
    if (!saved || typeof saved !== "object") return "system";
    const data = saved as { mode?: unknown; theme?: unknown };
    if (data.mode === "light" || data.mode === "dark" || data.mode === "system") return data.mode;
    // 旧版明确选择过的浅/深色保持原选择，不擅自改成跟随系统。
    return data.theme === "light" || data.theme === "dark" ? data.theme : "system";
}

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set, get) => ({
            mode: "system",
            theme: systemTheme(),
            setTheme: (theme) => {
                if (theme === "light" || theme === "dark") set({ mode: theme, theme });
            },
            setMode: (mode) => {
                if (mode !== "system" && mode !== "light" && mode !== "dark") return;
                set({ mode, theme: mode === "system" ? systemTheme() : mode });
            },
            syncSystemTheme: (dark) => {
                const theme = dark ? "dark" : "light";
                if (get().mode === "system" && get().theme !== theme) set({ theme });
            },
        }),
        {
            name: "infinite-canvas:theme_store",
            storage: createJSONStorage(() => sqliteStateStorage),
            partialize: (state) => ({ mode: state.mode }),
            merge: (saved, current) => {
                const mode = resolveThemeMode(saved);
                return { ...current, mode, theme: mode === "system" ? systemTheme() : mode };
            },
        },
    ),
);
