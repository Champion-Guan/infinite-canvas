import { createContext, useContext, useState, type ReactNode } from "react";

const SettingsViewportContext = createContext<HTMLDivElement | null>(null);
export const useSettingsViewport = () => useContext(SettingsViewportContext);

// 继承旧宿主顶栏下方 iframe 的视区边界；由 React 提供真实容器，不查询或改写 DOM。
export function SettingsViewport({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return <div ref={setContainer} className="relative min-h-0 flex-1 overflow-hidden" style={{ containerType: "size" }}>
    <SettingsViewportContext.Provider value={container}>{children}</SettingsViewportContext.Provider>
  </div>;
}
