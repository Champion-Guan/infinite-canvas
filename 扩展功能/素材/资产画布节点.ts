import type { Asset } from "@/stores/use-asset-store";
import { createCanvasNode, imageMetadata, videoMetadata, audioMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { CanvasNodeType, type Position } from "@/types/canvas";

// 只构造节点，不再次上传，也不新增图片间的业务关系。
export function assetCanvasNode(asset: Asset, center: Position) {
    if (asset.kind === "text") return { ...createCanvasNode(CanvasNodeType.Text, center, { content: asset.data.content, status: "success" }), title: asset.title };
    const type = asset.kind === "image" ? CanvasNodeType.Image : asset.kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Audio;
    const metadata = asset.kind === "image" ? imageMetadata({ ...asset.data, url: asset.data.dataUrl }) : asset.kind === "video" ? videoMetadata({ ...asset.data, storageKey: asset.data.storageKey || "" }) : audioMetadata({ ...asset.data, storageKey: asset.data.storageKey || "" });
    const node = { ...createCanvasNode(type, center, { ...metadata, storageKey: asset.data.storageKey }), title: asset.title };
    if (asset.kind === "audio") return node;
    const limit = asset.kind === "video" ? 420 : 640;
    const size = fitNodeSize(asset.data.width || node.width, asset.data.height || node.height, limit, limit);
    return { ...node, ...size, position: { x: center.x - size.width / 2, y: center.y - size.height / 2 } };
}
