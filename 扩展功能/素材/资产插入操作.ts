import { useCallback } from "react";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import type { Position } from "@/types/canvas";
import type { Dispatch, SetStateAction } from "react";
import { assetCanvasNode } from "./资产画布节点";
import type { PlacementBounds } from "../画布布局/卡片自动避让";
import { placeAssetNode } from "./资产可见落点";
import type { CanvasNodePlacement, CanvasNodeSetter } from "../画布生成/画布节点事务";

export function useCanvasAssetInsertion({ projectId, setNodes, setSelectedNodeIds, setSelectedConnectionId, getVisibleBounds, onError }: {
    projectId: string; setNodes: CanvasNodeSetter;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    getVisibleBounds?: () => PlacementBounds | undefined;
    onError: (text: string) => void;
}) {
    return useCallback(async (assetId: string, center: Position, placement: CanvasNodePlacement = "auto") => {
        try {
            let asset = useAssetStore.getState().assets.find(item => item.id === assetId);
            if (!asset) throw new Error("该资产已被移除，请重新选择。");
            const owner = asset.metadata?.projectId;
            if (owner && owner !== projectId && asset.metadata?.source !== "prompt-library") throw new Error("该资产属于其他画布，请在对应画布中添加。");
            if (asset.kind === "image") asset = { ...asset, data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) } };
            else if (asset.kind !== "text") asset = { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
            if (!useAssetStore.getState().assets.some(item => item.id === assetId) || !useCanvasStore.getState().projects.some(item => item.id === projectId)) return;
            const node = assetCanvasNode(asset, center);
            setNodes(previous => [...previous, placement === "exact" ? node : placeAssetNode(node, previous, getVisibleBounds?.())], placement);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        } catch (error) { onError(error instanceof Error ? error.message : "添加资产失败，请重试。"); }
    }, [projectId, setNodes, setSelectedNodeIds, setSelectedConnectionId, getVisibleBounds, onError]);
}
