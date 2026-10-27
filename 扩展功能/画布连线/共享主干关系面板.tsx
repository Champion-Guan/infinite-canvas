import { placeConnectionPicker, type PickerBox } from "./关系面板避让";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ConnectionGeometry } from "./圆角连线路由";
import type { CanvasNodeData } from "@/types/canvas";

type Props = {
    choices: readonly ConnectionGeometry[];
    x: number;
    y: number;
    contextMenu: boolean;
    onPreview: (id: string | null) => void;
    onChoose: (id: string) => void;
    onClose: () => void;
};
function Thumbnail({ node }: { node: CanvasNodeData }) {
    if (node.type !== "image") return <span aria-hidden="true" style={{ fontSize: 11, opacity: .65 }}>卡片</span>;
    const image = node.metadata?.images?.find(image => image.id === node.metadata?.primaryImageId) ?? node.metadata?.images?.[0];
    const src = image?.content || node.metadata?.content;
    return src && /^(data:image\/|blob:|https?:\/)/.test(src) ? <img src={src} alt="" loading="lazy" style={{ width: 40, height: 40, objectFit: "contain", borderRadius: 6 }} /> : <span aria-hidden="true">图片</span>;
}
export function SharedConnectionPicker({ choices, x, y, contextMenu, onPreview, onChoose, onClose }: Props) {
    const panel = useRef<HTMLDivElement>(null);
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const height = Math.min(420, window.innerHeight - 24);
    const width = Math.min(420, window.innerWidth - 24);
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
    useLayoutEffect(() => {
        const update = () => {
            const viewport = document.querySelector(".guan-canvas-viewport")?.getBoundingClientRect();
            const view = { left: Math.max(12, (viewport?.left ?? 0) + 12), top: Math.max(12, (viewport?.top ?? 0) + 12), right: Math.min(window.innerWidth - 12, (viewport?.right ?? window.innerWidth) - 12), bottom: Math.min(window.innerHeight - 12, (viewport?.bottom ?? window.innerHeight) - 72) };
            const elements = new Map([...document.querySelectorAll<HTMLElement>("[data-node-id]")].map(element => [element.dataset.nodeId, element]));
            const cards = new Map<string, PickerBox>();
            const lines: PickerBox[] = [];
            for (const item of choices) {
                const element = elements.get(item.from.id) ?? elements.get(item.to.id);
                if (!element) continue;
                const node = elements.has(item.from.id) ? item.from : item.to;
                const rect = element.getBoundingClientRect(), scale = rect.width / node.width;
                const offsetX = rect.left - node.position.x * scale, offsetY = rect.top - node.position.y * scale;
                for (const endpoint of [item.from, item.to]) cards.set(endpoint.id, { left: offsetX + endpoint.position.x * scale - 12, top: offsetY + endpoint.position.y * scale - 12, right: offsetX + (endpoint.position.x + endpoint.width) * scale + 12, bottom: offsetY + (endpoint.position.y + endpoint.height) * scale + 12 });
                item.route.points.slice(1).forEach((b, index) => {
                    const a = item.route.points[index];
                    lines.push({ left: offsetX + Math.min(a.x, b.x) * scale - 12, right: offsetX + Math.max(a.x, b.x) * scale + 12, top: offsetY + Math.min(a.y, b.y) * scale - 12, bottom: offsetY + Math.max(a.y, b.y) * scale + 12 });
                });
            }
            const actual = panel.current?.getBoundingClientRect();
            setPosition(placeConnectionPicker(view, { width: actual?.width ?? width, height: actual?.height ?? height }, { x, y }, [...cards.values()], lines));
        };
        update();
        const observer = new ResizeObserver(update);
        if (panel.current) observer.observe(panel.current);
        window.addEventListener("resize", update);
        return () => { observer.disconnect(); window.removeEventListener("resize", update); };
    }, [choices, x, y, width, height]);
    const left = position?.left ?? 12, top = position?.top ?? 12;
    useEffect(() => {
        const previous = document.activeElement;
        panel.current?.querySelector<HTMLButtonElement>("[data-relation-choice]")?.focus({ preventScroll: true });
        const outside = (event: PointerEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target)) onClose(); };
        const key = (event: KeyboardEvent) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
            // 选择具体关系前禁止画布的全局删除快捷键作用于旧选择。
            if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopImmediatePropagation(); }
            if (event.key === "Tab") {
                const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1)?.focus(); }
                else if (!event.shiftKey && index === buttons.length - 1) { event.preventDefault(); buttons[0]?.focus(); }
            }
        };
        document.addEventListener("pointerdown", outside, true);
        window.addEventListener("keydown", key, true);
        return () => {
            document.removeEventListener("pointerdown", outside, true);
            window.removeEventListener("keydown", key, true);
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
        };
    }, [onClose]);
    return createPortal(<div ref={panel} role="dialog" aria-label="选择共享主干中的连接" aria-modal="false" data-shared-connection-picker="true"
        onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
        style={{ position: "fixed", left, top, width, maxHeight: height, visibility: position ? "visible" : "hidden", zIndex: 10000, pointerEvents: "auto", color: theme.node.text, background: theme.canvas.background, border: `1px solid ${theme.node.muted}66`, borderRadius: 14, boxShadow: "0 12px 40px #0003", padding: 8, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px 10px", gap: 12 }}>
            <div><strong style={{ fontSize: 14 }}>选择连接 · {choices.length} 条</strong><div style={{ fontSize: 12, opacity: .65, marginTop: 4 }}>{contextMenu ? "选定关系后打开操作菜单" : "悬浮预览，点击确定"}</div></div>
            <button type="button" aria-label="关闭关系选择" onClick={onClose} style={{ padding: "4px 8px", borderRadius: 6 }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", minHeight: 0, overscrollBehavior: "contain" }} onMouseLeave={() => onPreview(null)}>
            {choices.map(item => <button type="button" key={item.connection.id} data-relation-choice={item.connection.id}
                onMouseEnter={() => onPreview(item.connection.id)} onFocus={() => onPreview(item.connection.id)} onBlur={() => onPreview(null)} onClick={() => onChoose(item.connection.id)}
                style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) 44px", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: 10, borderRadius: 8, cursor: "pointer" }}>
                <Thumbnail node={item.from} />
                <span style={{ minWidth: 0, fontSize: 13 }}><span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.from.title || item.from.id}>{item.from.title || "来源卡片"}</span><span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: .7, marginTop: 4 }} title={item.to.title || item.to.id}>→ {item.to.title || "目标卡片"}</span></span>
                <Thumbnail node={item.to} />
            </button>)}
        </div>
    </div>, document.body);
}
