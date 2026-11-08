import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { buildProductParameterEdits } from "./产品参数联动";
import { productMainImages, productMainImagesPatch, type ProductMainImage } from "./产品主图规则";
import { productVariants, type ProductVariant, type ProductVariantMetadata } from "./产品变体规则";
import { normalizedPlanningSnapshot, productPlanningChanges, productPlanningParameterKeys, promptDocument,
    type ProductPlanningParameters, type ProductPromptMetadata } from "./商品提示词规则";

export function productPromptRestoreOps(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeIds: string[]) {
    const targets = nodes.filter(node => nodeIds.includes(node.id) && promptDocument(node));
    if (!targets.length) throw Error("提示词卡片已移除，请检查当前画布。");
    const groups = new Map<string, string>();
    for (const node of targets) {
        const doc = promptDocument(node)!;
        const fingerprint = (node.metadata as ProductPromptMetadata).productPromptSourceFingerprint;
        if (!fingerprint || !normalizedPlanningSnapshot(fingerprint)) throw Error("原商品资料记录缺失，请重新使用“AI写提示词”更新原卡片。");
        if (groups.has(doc.parameterId) && groups.get(doc.parameterId) !== fingerprint)
            throw Error("这些提示词使用了不同版本的商品资料，无法同时恢复。请重新使用“AI写提示词”更新原卡片。");
        groups.set(doc.parameterId, fingerprint);
    }
    return [...groups].flatMap(([parameterId, fingerprint]) => {
        const parameter = nodes.find(node => node.id === parameterId);
        if (!parameter) throw Error("原产品参数卡已移除，请先恢复参数卡。");
        const current = parameter.metadata as ProductVariantMetadata;
        if (!productPlanningChanges(current, fingerprint, { ignoreLanguage: true }).length) return [];
        const [facts, references] = normalizedPlanningSnapshot(fingerprint)!;
        const source = (parameter.metadata as ProductPromptMetadata).productImagePlan?.source;
        let patch: ProductPlanningParameters;
        if (source?.fingerprint === fingerprint) patch = JSON.parse(source.parameters) as ProductPlanningParameters;
        else {
            const images = references.map(value => {
                const [id, storageKey, url] = value as [string, string | undefined, string | undefined];
                const old = productMainImages(current).find(image => image.id === id && (storageKey ? image.storageKey === storageKey : image.url === url));
                const name = (facts.images as Array<{ id: string; name: string }>).find(image => image.id === id)?.name || id;
                return old ? { ...old, name } : { id, name, storageKey, url: storageKey ? undefined : url };
            });
            const variants = facts.variants as Array<{ id: string; name: string; attributes: Record<string, string>;
                brief: ProductVariant["brief"]; variables: Record<string, string>; imageIds: string[] }>;
            const shared = variants.length ? variants[0].imageIds.filter(id => variants.every(variant => variant.imageIds.includes(id) && variant.imageIds[0] !== id)) : [];
            patch = { productPlatform: String(facts.platform), productPlatformRules: String(facts.channelRequirements || ""),
                productBrief: { ...current.productBrief, ...facts.brief as ProductVariantMetadata["productBrief"] },
                promptVariableValues: facts.variables as Record<string, string>, promptVariableSupplement: String(facts.supplement || ""),
                ...productMainImagesPatch(images), productSharedImageIds: shared,
                productVariants: variants.map(variant => ({ ...productVariants(current).find(item => item.id === variant.id),
                    id: variant.id, name: variant.name, attributes: variant.attributes, enabled: true, brief: variant.brief,
                    variableValues: variant.variables, imageIds: variant.imageIds.filter(id => !shared.includes(id)), primaryImageId: variant.imageIds[0] })) };
            const beforeBrief = facts.brief as Record<string, string>;
            for (const key of Object.keys(patch.productBrief || {})) if (!["carouselCount", "generationTool"].includes(key) && !(key in beforeBrief))
                delete (patch.productBrief as Record<string, string>)[key];
        }
        // 语言可独立修改；变体勾选只决定执行范围，恢复时不改变用户的选择。
        patch.productVariants = patch.productVariants?.map(variant => ({ ...variant,
            enabled: productVariants(current).find(item => item.id === variant.id)?.enabled ?? variant.enabled }));
        const images = patch.productMainImages?.map(image => {
            const existing = productMainImages(current).find(item => item.id === image.id && item.storageKey === image.storageKey);
            return image.storageKey ? { ...image, url: existing?.url } : image;
        });
        if (images) Object.assign(patch, productMainImagesPatch(images));
        const completePatch = Object.fromEntries(productPlanningParameterKeys.map(key => [key, patch[key]])) as ProductVariantMetadata;
        const restored = { ...current, ...completePatch };
        const remaining = productPlanningChanges(restored, fingerprint, { ignoreLanguage: true });
        if (remaining.length) throw Error(`无法完整恢复${remaining.join("、")}，请重新使用“AI写提示词”更新原卡片。`);
        return buildProductParameterEdits(nodes, connections, parameterId, completePatch);
    });
}

export function restoredProductImages(nodes: CanvasNodeData[], ops: ReturnType<typeof productPromptRestoreOps>): ProductMainImage[] {
    return ops.flatMap(op => {
        if (op.type !== "update_node") return [];
        const images = (op.metadata as ProductVariantMetadata | undefined)?.productMainImages;
        if (!images) return [];
        const before = productMainImages(nodes.find(node => node.id === op.id)?.metadata);
        return images.filter(image =>
            !before.some(item => item.id === image.id && (image.storageKey ? item.storageKey === image.storageKey : item.url === image.url)));
    });
}
