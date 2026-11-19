import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/**
 * 简化版画布节点 - 用于拖动和缩放时的降级渲染
 * 只显示节点边框和基础内容，大幅减少渲染开销
 */
export function SimplifiedCanvasNode({
    data,
    scale,
    isSelected,
}: {
    data: CanvasNodeData;
    scale: number;
    isSelected?: boolean;
}) {
    const theme = useThemeStore((state) => state.theme);
    const colors = canvasThemes[theme];

    const borderWidth = Math.max(1, 2 / scale);
    const borderRadius = Math.max(4, 8 / scale);
    const selectionBlue = "#2f80ff";

    return (
        <div
            data-node-id={data.id}
            data-node-simplified="true"
            className="absolute"
            style={{
                left: data.position.x,
                top: data.position.y,
                width: data.size.width,
                height: data.size.height,
                border: `${borderWidth}px solid ${isSelected ? selectionBlue : colors.node.border}`,
                background: colors.node.fill,
                borderRadius,
                boxShadow: isSelected ? `0 0 0 ${Math.max(2, 4 / scale)}px ${selectionBlue}20` : undefined,
                pointerEvents: "none",
                opacity: 0.9,
                overflow: "hidden",
            }}
        >
            {/* 图片节点显示缩略图 */}
            {data.type === CanvasNodeType.Image && data.metadata?.content && (
                <img
                    src={data.metadata.content}
                    alt=""
                    className="w-full h-full object-cover"
                    style={{
                        borderRadius: borderRadius - borderWidth,
                        imageRendering: scale < 0.5 ? "pixelated" : "auto",
                    }}
                />
            )}

            {/* 视频节点显示图标 */}
            {data.type === CanvasNodeType.Video && (
                <div className="flex items-center justify-center w-full h-full text-stone-400">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                </div>
            )}

            {/* 文本节点显示占位 */}
            {data.type === CanvasNodeType.Text && (
                <div
                    className="p-2 text-stone-600 dark:text-stone-400 text-sm leading-relaxed overflow-hidden"
                    style={{
                        fontSize: Math.max(10, 14 / scale),
                    }}
                >
                    {data.metadata?.content?.slice(0, 100)}
                </div>
            )}

            {/* 配置节点显示图标 */}
            {data.type === CanvasNodeType.Config && (
                <div className="flex items-center justify-center w-full h-full text-stone-400">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M12 1v6m0 6v6m-5-7H1m6 0h6m6 0h6"></path>
                    </svg>
                </div>
            )}
        </div>
    );
}
