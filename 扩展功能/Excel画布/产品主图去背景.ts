import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { CanvasImageReceipt, CanvasImageTask } from "../画布生成/原画布图片调用";
import { applyProductImageCutout, productMainImages, productMainImagesPatch, sameProductImageSource, type ProductImageMetadata } from "./产品主图规则";

export const PRODUCT_BACKGROUND_REMOVAL_PROMPT = "Remove only the background of the supplied product photo and return a transparent PNG. Preserve the product exactly: its shape, proportions, colors, material, texture, printed text, details and all included parts. Do not redraw, retouch, add objects, add shadows or crop the product.";

export async function removeProductMainImageBackground({ ctx, productId, imageId, signal }: {
    ctx: CanvasNodeContext; productId: string; imageId: string; signal: AbortSignal;
}) {
    const read = () => {
        signal.throwIfAborted();
        const node = ctx.getNode(ctx.node.id);
        const image = productMainImages(node?.metadata as ProductImageMetadata).find(item => item.id === imageId);
        if (!node || !image) throw new Error("产品主图已移除，未替换其他图片。");
        return { node, image };
    };
    const { image: source } = read();
    const slotId = `product-main-image:${imageId}`;
    const assertSource = (taskId?: string) => {
        const current = read();
        if (!sameProductImageSource(current.image, source)) throw new Error("产品主图已更改，未覆盖新的图片。");
        if (taskId && current.node.metadata?.gatewayGenerationTasks?.find(task => task.slotId === slotId)?.taskId !== taskId)
            throw new Error("这张产品主图已有新的处理任务，未覆盖当前图片。");
        return current;
    };
    const [{ requestCanvasImage }, { useConfigStore }, { buildGenerationConfig }, { saveProductCanvas }, storage] = await Promise.all([
        import("../画布生成/原画布图片调用"), import("@/stores/use-config-store"),
        import("@/lib/canvas/canvas-generation-helpers"), import("../产品/产品操作"), import("@/services/image-storage"),
    ]);
    const state = useConfigStore.getState();
    // 原图可能是任意像素尺寸，不能套用交付尺寸的16px网格校验。
    const config = { ...buildGenerationConfig(state.config, undefined, "image"), count: "1", background: "transparent", size: "auto" };
    if (!state.isAiConfigReady(config, config.model)) {
        state.openConfigDialog(false, "channels");
        throw new Error("请先配置可用的生图渠道，原图已保留。");
    }
    assertSource();
    await requestCanvasImage({
        config, prompt: PRODUCT_BACKGROUND_REMOVAL_PROMPT, signal, retry: true,
        references: [{ id: source.id, name: source.name, type: source.mimeType || "image/png", storageKey: source.storageKey, dataUrl: source.url || "" }],
        scope: { productId, nodeId: ctx.node.id, slotId },
        previous: read().node.metadata?.gatewayGenerationTasks?.find(task => task.slotId === slotId),
        recordTask: async (task: CanvasImageTask) => {
            const { node } = assertSource();
            ctx.updateMetadata({ gatewayGenerationTasks: [...(node.metadata?.gatewayGenerationTasks || []).filter(item => item.slotId !== slotId), task] });
            await saveProductCanvas(productId);
        },
        applyAndSave: async (result, receipt: CanvasImageReceipt) => {
            assertSource(receipt.taskId);
            const uploaded = await storage.uploadImage(result.dataUrl, { signal, registerAsset: false });
            const { node } = assertSource(receipt.taskId);
            const images = productMainImages(node.metadata as ProductImageMetadata).map(image =>
                image.id === imageId ? applyProductImageCutout(image, uploaded) : image);
            ctx.updateMetadata({ ...productMainImagesPatch(images), status: "success",
                gatewayGenerationReceipts: [...(node.metadata?.gatewayGenerationReceipts || []).filter(item => item.taskId !== receipt.taskId), receipt],
            });
            return await saveProductCanvas(productId);
        },
    });
}
