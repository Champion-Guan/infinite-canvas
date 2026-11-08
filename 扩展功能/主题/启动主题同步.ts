import { resolveThemeMode } from "./主题模式规则";

// 只依赖已预读快照与纯规则，不提前导入会拉取界面CSS的React公共分包。
export function applyStartupTheme(snapshot: string | null, document: Document = window.document) {
  const saved: unknown = snapshot === null ? null : JSON.parse(snapshot);
  const mode = resolveThemeMode(saved && typeof saved === "object" && "state" in saved ? saved.state : null);
  const theme = mode === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" : mode;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}
