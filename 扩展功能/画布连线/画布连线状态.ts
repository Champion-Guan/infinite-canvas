import { useEffect, useMemo, useRef, useState } from "react";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { buildSharedConnectionGeometry } from "./圆角连线路由";
import { connectionInteractionFocus } from "./连线关系聚焦";
import { obscuredInlineResults } from "./并排图片关系透视";
import type { PortAlignmentGuide } from "./连线端口吸附";

// 路由记忆、预览与浮层只属于当前挂载的画布，不进入保存/撤销数据。
export function useCanvasConnectionSystem(connections: CanvasConnection[], nodeById: ReadonlyMap<string, CanvasNodeData>, selectedNodeIds: ReadonlySet<string>, selectedConnectionId: string | null, hoveredNodeId: string | null) {
    const previous = useRef<ReturnType<typeof buildSharedConnectionGeometry>>([]);
    const connectionGeometry = useMemo(() => buildSharedConnectionGeometry(connections, nodeById, undefined, previous.current), [connections, nodeById]);
    useEffect(() => { previous.current = connectionGeometry; }, [connectionGeometry]);
    const [cardEndpointTarget, setCardEndpointTarget] = useState<HTMLDivElement | null>(null);
    const [cardPanelTarget, setCardPanelTarget] = useState<HTMLDivElement | null>(null);
    const [connectionFocusTarget, setConnectionFocusTarget] = useState<SVGGElement | null>(null);
    const [displayConnectionIds, setDisplayConnectionIds] = useState<ReadonlySet<string>>(new Set());
    const [connectionPreviewNodeIds, setConnectionPreviewNodeIds] = useState<ReadonlySet<string>>(new Set());
    const [portAlignmentGuide, setPortAlignmentGuide] = useState<PortAlignmentGuide | null>(null);
    const connectionFocus = useMemo(() => connectionInteractionFocus(connectionGeometry, selectedNodeIds, selectedConnectionId, hoveredNodeId), [connectionGeometry, selectedNodeIds, selectedConnectionId, hoveredNodeId]);
    const obscuredResultIds = useMemo(() => obscuredInlineResults(connectionGeometry, displayConnectionIds), [connectionGeometry, displayConnectionIds]);
    const selected = selectedNodeIds.size === 1 ? [...selectedNodeIds][0] : null;
    const keepFocusBehindCards = Boolean(hoveredNodeId ? nodeById.get(hoveredNodeId)?.type === "config" : !selectedConnectionId && selected && nodeById.get(selected)?.type === "config");
    return { connectionGeometry, connectionFocus, obscuredResultIds, connectionPreviewNodeIds, setConnectionPreviewNodeIds, cardEndpointTarget, setCardEndpointTarget, cardPanelTarget, setCardPanelTarget, connectionFocusTarget, setConnectionFocusTarget, setDisplayConnectionIds, keepFocusBehindCards, portAlignmentGuide, setPortAlignmentGuide };
}
