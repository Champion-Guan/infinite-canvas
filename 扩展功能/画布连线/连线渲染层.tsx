import { createPortal } from "react-dom";
import { sharedNetworkFlow } from "./共享网络数据流";
import { connectionJunctionDots, softJunctionContours } from "./连线交点整理";
import "./连线数据流动画.css";
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { memo, useMemo, useState, useCallback, useEffect } from "react";

import { SharedConnectionPicker } from "./共享主干关系面板";
import { sharedConnectionAction, sharedConnectionChoices } from "./共享主干关系选择";
import { canvasThemes } from "@/lib/canvas-theme";
import { connectionDesign, connectionScreenMetrics } from "./连线视觉设计";
import { mergeSharedConnectionSegments, routeConnection, type ConnectionGeometry, type SharedConnectionSegment } from "./圆角连线路由";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

type SharedConnectionLayerProps = {
    geometry: readonly ConnectionGeometry[];
    flowGeometry?: readonly ConnectionGeometry[];
    focusedIds: ReadonlySet<string>;
    focusTarget?: SVGGElement | null;
    keepFocusBehindCards?: boolean;
    onFocusConnections?: (ids: ReadonlySet<string>) => void;
    scale: number;
    dragging: boolean;
    onSelect: (id: string) => void;
    onPreviewNodes?: (ids: ReadonlySet<string>) => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>, id: string) => void;
};

export const SharedConnectionLayer = memo(function SharedConnectionLayer({ geometry, flowGeometry, focusedIds, scale, dragging, onSelect, onContextMenu, onPreviewNodes, focusTarget, onFocusConnections, keepFocusBehindCards = false }: SharedConnectionLayerProps) {
    const themeName = useThemeStore(state => state.theme);
    const theme = canvasThemes[themeName];
    const palette = connectionDesign[themeName];
    const metrics = connectionScreenMetrics(scale);
    const network = useMemo(() => {
        const occurrences = new Map<string, number>();
        return mergeSharedConnectionSegments(geometry).map(segment => {
            // 命中区使用关系ID与段序号作key，拖动时不因坐标变化整批重建。
            const signature = segment.key[0] + ":" + [...segment.connectionIds].sort().join("|");
            const occurrence = occurrences.get(signature) ?? 0;
            occurrences.set(signature, occurrence + 1);
            return { ...segment, renderKey: `${signature}:${occurrence}` };
        });
    }, [geometry]);
    const [request, setRequest] = useState<{ ids: string[]; x: number; y: number; event?: ReactMouseEvent<SVGPathElement> } | null>(null);
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [hoverIds, setHoverIds] = useState<readonly string[] | null>(null);
    const choices = useMemo(() => sharedConnectionChoices(request?.ids ?? [], geometry), [request, geometry]);
    const displayIds = useMemo(() => previewId ? new Set([previewId]) : request ? new Set(request.ids) : hoverIds ? new Set(hoverIds) : focusedIds, [previewId, request, hoverIds, focusedIds]);
    const hoveringConnection = Boolean(hoverIds && !request && !previewId);
    // 连线悬浮只预览路径，不穿透卡片；选中或关系条目预览仍可查看被遮挡的关系。
    const perspectiveIds = useMemo(() => hoveringConnection ? new Set<string>() : displayIds, [hoveringConnection, displayIds]);
    useEffect(() => { onFocusConnections?.(perspectiveIds); }, [perspectiveIds, onFocusConnections]);
    const focused = useMemo(() => geometry.filter(item => displayIds.has(item.connection.id)), [geometry, displayIds]);
    const closePicker = useCallback(() => { setRequest(null); setPreviewId(null); setHoverIds(null); onPreviewNodes?.(new Set()); }, [onPreviewNodes]);
    useEffect(() => { if (request && (dragging || !choices.length)) closePicker(); }, [request, dragging, choices.length, closePicker]);
    const focusSegments = useMemo(() => mergeSharedConnectionSegments(focused, geometry), [focused, geometry]);
    const junctionContour = useMemo(() => softJunctionContours(geometry.map(item => item.route.points), geometry.map(item => item.route.points), 1, connectionDesign.lineWidth), [geometry, scale]);
    const focusContour = useMemo(() => softJunctionContours(focused.map(item => item.route.points), geometry.map(item => item.route.points), 1, connectionDesign.focusWidth), [focused, geometry, scale]);
    const junctionDots = useMemo(() => connectionJunctionDots(geometry.map(item => item.route.points)), [geometry]);
    const focusDots = useMemo(() => connectionJunctionDots(focused.map(item => item.route.points), geometry.map(item => item.route.points)), [focused, geometry]);
    const flowNetwork = useMemo(() => sharedNetworkFlow((flowGeometry ?? geometry).filter(item => displayIds.has(item.connection.id)), flowGeometry ?? geometry), [flowGeometry, geometry, displayIds]);
    const byId = useMemo(() => new Map(geometry.map(item => [item.connection.id, item])), [geometry]);
    const preview = useCallback((id: string | null) => {
        setPreviewId(id);
        const item = id ? byId.get(id) : undefined;
        onPreviewNodes?.(new Set(item ? [item.from.id, item.to.id] : []));
    }, [byId, onPreviewNodes]);
    const activate = (segment: SharedConnectionSegment, event: ReactMouseEvent<SVGPathElement> | ReactKeyboardEvent<SVGPathElement>, context = false) => {
        event.preventDefault(); event.stopPropagation();
        const action = sharedConnectionAction(segment.connectionIds, geometry);
        if (action.type === "none") return;
        if (action.type === "select") {
            closePicker();
            if (context && "clientX" in event) onContextMenu?.(event, action.id); else onSelect(action.id);
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        setPreviewId(null);
        setRequest({ ids: action.choices.map(item => item.connection.id), x: "clientX" in event ? event.clientX : rect.x + rect.width / 2, y: "clientY" in event ? event.clientY : rect.y + rect.height / 2, event: context && "clientX" in event ? event : undefined });
    };
    const choose = (id: string) => {
        if (!choices.some(item => item.connection.id === id)) return;
        const contextEvent = request?.event;
        closePicker();
        if (contextEvent) onContextMenu?.(contextEvent, id); else onSelect(id);
    };
    const focusVisual = focusSegments.length ? <g
                data-connection-focus={focused.map(item => item.connection.id).join(" ")}
                style={{ pointerEvents: "none" }}
            >
                <path data-focus-ink="true" d={focusSegments.map(segment => segment.d).join(" ")} stroke={connectionDesign.focusColor} strokeWidth={metrics.focus} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <path data-focus-junction-contour="true" d={focusContour} fill={connectionDesign.focusColor} stroke="none" />
                {focusDots.map(point => <circle key={point.key} data-focus-junction-dot="true" cx={point.x} cy={point.y} r={3.5} fill={connectionDesign.focusColor} />)}

                {!dragging ? flowNetwork.segments.map(segment => {
                    const count = Math.max(1, Math.floor(flowNetwork.total / 180));
                    const duration = Math.max(1.2, flowNetwork.total / 100);
                    const times = `0;${segment.start};${segment.end};1`;
                    return <g key={segment.id} className="connection-flow-particles" data-flow-segment={segment.id}>
                        {Array.from({ length: count }, (_, index) => <circle key={index} data-flow-particle="true" r={3.5} fill="#ffffff" stroke={connectionDesign.focusColor} strokeWidth={1.3}>
                            <animateMotion dur={`${duration}s`} begin={`${-index * duration / count}s`} repeatCount="indefinite" calcMode="linear" keyPoints="0;0;1;1" keyTimes={times} path={segment.d} />
                            <animate attributeName="opacity" values="0;1;0;0" calcMode="discrete" keyTimes={times} dur={`${duration}s`} begin={`${-index * duration / count}s`} repeatCount="indefinite" />
                        </circle>)}
                    </g>;
                }) : null}
            </g> : null;
    return (
        <g data-shared-network-size={network.length} data-connection-design="soft-spine">
            <path d={network.map(segment => segment.d).join(" ")} stroke={theme.canvas.background} strokeWidth={metrics.backdrop} strokeLinecap="round" strokeLinejoin="round" fill="none" pointerEvents="none" />
            <g opacity={displayIds.size ? palette.contextOpacity : palette.opacity}>
            <path
                data-shared-network="true"
                d={network.map(segment => segment.d).join(" ")}
                stroke={palette.line}
                strokeWidth={metrics.line}
                strokeLinecap="round"
                strokeLinejoin="round"

                fill="none"
                pointerEvents="none"
            />
            <path data-junction-contour="true" d={junctionContour} fill={palette.line} stroke="none" pointerEvents="none" />
            {junctionDots.map(point => <circle key={point.key} data-junction-dot="true" cx={point.x} cy={point.y} r={3.5} fill={palette.line} pointerEvents="none" />)}
            </g>
            {network.map(segment => {
                const single = segment.connectionIds.length === 1 ? byId.get(segment.connectionIds[0]) : undefined;
                const label = single ? `${single.from.title || "来源卡片"} → ${single.to.title || "目标卡片"}` : `共享主干 · ${segment.connectionIds.length}条关系`;
                return <path
                    key={segment.renderKey}
                    data-connection-id={single?.connection.id}
                    data-shared-connection-ids={segment.connectionIds.join(" ")}
                    d={segment.d}
                    stroke="transparent"
                    strokeWidth={metrics.hit}
                    fill="none"

                    style={{ cursor: "pointer", pointerEvents: "stroke", outline: "none" }}
                    role="button"
                    aria-label={label}
                    tabIndex={0}
                    aria-haspopup={single ? undefined : "dialog"}
                    aria-expanded={single ? undefined : Boolean(request && request.ids.length === segment.connectionIds.length && request.ids.every(id => segment.connectionIds.includes(id)))}
                    onMouseEnter={() => setHoverIds(segment.connectionIds)}
                    onMouseLeave={() => setHoverIds(null)}
                    onFocus={() => setHoverIds(segment.connectionIds)}
                    onBlur={() => setHoverIds(null)}
                    onPointerDown={event => event.stopPropagation()}
                    onDoubleClick={event => event.stopPropagation()}
                    onMouseDown={event => event.stopPropagation()}
                    onClick={event => activate(segment, event)}
                    onContextMenu={event => activate(segment, event, true)}
                    onKeyDown={event => {
                        if (event.key === "Enter" || event.key === " ") activate(segment, event);
                    }}
                ><title>{label}</title></path>;
            })}
            {focusTarget && !hoveringConnection && (!keepFocusBehindCards || previewId || request) ? createPortal(focusVisual, focusTarget) : focusVisual}
            {request && choices.length ? <SharedConnectionPicker choices={choices} x={request.x} y={request.y} contextMenu={Boolean(request.event)} onPreview={preview} onChoose={choose} onClose={closePicker} /> : null}
        </g>
    );
});

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const pointer = { position: mouseWorld, width: 0, height: 0 };
    const from = handle.handleType === "source" ? node : target ?? pointer;
    const to = handle.handleType === "source" ? target ?? pointer : node;
    const pathD = routeConnection(from, to).d;

    return <path d={pathD} stroke={theme.node.activeStroke} strokeWidth="2" fill="none" strokeDasharray="5,5" />;
}
