import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { productImageSource, type ProductImageSource } from "./产品主图规则";
import { confirmationAnswer, confirmationAnswerPatch, confirmationDefinition, confirmationFields,
    type Confirmation, type ConfirmationMetadata } from "./商品待确认规则";

export async function uploadConfirmationFiles({ ctx, productId, field, variantId, files, signal, upload }: {
    ctx: CanvasNodeContext; productId: string; field: Confirmation; variantId?: string; files: File[]; signal: AbortSignal;
    upload(file: File, options: { assetProjectId: string; signal: AbortSignal }): Promise<ProductImageSource>;
}) {
    const read = () => {
        signal.throwIfAborted();
        const node = ctx.getNode(ctx.node.id);
        const current = confirmationFields(node?.metadata as ConfirmationMetadata).find(item => item.id === field.id);
        if (!node || !current || confirmationDefinition(current) !== confirmationDefinition(field))
            throw Error("待确认事项已变化，未将图片写入其他卡片。");
        return node.metadata as ConfirmationMetadata;
    };
    for (const file of files) {
        read();
        if (!file.type.startsWith("image/") && !/\.(heic|heif|png|jpe?g|webp|avif)$/i.test(file.name)) throw Error("请选择对应实拍图片。");
        const image = await upload(file, { assetProjectId: productId, signal });
        const metadata = read();
        const images = confirmationAnswer(metadata, field, variantId)?.images || [];
        ctx.updateMetadata(confirmationAnswerPatch(metadata, field, variantId,
            { images: [...images, { ...productImageSource(image), id: crypto.randomUUID(), name: file.name }] }));
    }
}
