import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const LocalStatusContext = createContext<HTMLDivElement | null>(null);

// 两种本机状态共享自然文档流，长错误文案和窄窗口不再靠固定偏移量避让。
export function LocalStatusRegion({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return <LocalStatusContext.Provider value={container}>
    {children}
    <div ref={setContainer} role="region" aria-label="本机状态通知区" style={{ position: "fixed", right: 20, bottom: 20, zIndex: 80, width: "min(360px, calc(100vw - 40px))", maxHeight: "calc(100dvh - 104px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }} />
  </LocalStatusContext.Provider>;
}

export function LocalStatusNotice({ children, order }: { children: ReactNode; order: number }) {
  const container = useContext(LocalStatusContext);
  const notice = <div style={{ order }}>{children}</div>;
  return container ? createPortal(notice, container) : <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 80, maxWidth: "min(360px, calc(100vw - 40px))" }}>{children}</div>;
}
