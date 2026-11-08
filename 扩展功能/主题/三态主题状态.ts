import { sqliteStateStorage } from "../本机存储/上游浏览器存储桥";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveThemeMode, type ThemeName, type ThemeMode } from "./主题模式规则";

export { resolveThemeMode, type ThemeName, type ThemeMode } from "./主题模式规则";
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

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set, get) => ({
            mode: "system",
            theme: systemTheme(),
            setTheme: (theme) => {
                if (theme !== "light" && theme !== "dark") return;
                if (get().mode === theme && get().theme === theme) return;
                set({ mode: theme, theme });
            },
            setMode: (mode) => {
                if (mode !== "system" && mode !== "light" && mode !== "dark") return;
                const nextTheme = mode === "system" ? systemTheme() : mode;
                if (get().mode === mode && get().theme === nextTheme) return;
                set({ mode, theme: nextTheme });
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
