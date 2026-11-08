export type ThemeName = "light" | "dark";
export type ThemeMode = ThemeName | "system";

export function resolveThemeMode(saved: unknown): ThemeMode {
  if (!saved || typeof saved !== "object") return "system";
  const data = saved as { mode?: unknown; theme?: unknown };
  if (data.mode === "light" || data.mode === "dark" || data.mode === "system") return data.mode;
  return data.theme === "light" || data.theme === "dark" ? data.theme : "system";
}
