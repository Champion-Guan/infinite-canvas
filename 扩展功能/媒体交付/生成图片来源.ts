import { numberGeneratedImages, restoreVariantImageNames } from "./生成图片命名";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";
import { productPromptTitle, type ProductPromptMetadata } from "../Excel画布/商品提示词规则";
import { WILDBERRIES_PLATFORM } from "../Excel画布/旧版参数规则";
import type { ProductVariantMetadata } from "../Excel画布/产品变体规则";

type WBImageNaming = { label: string; sequence: number };
type NamedMetadata = NonNullable<CanvasNodeData["metadata"]> & { wbImageNaming?: WBImageNaming; productVariant?: { id: string } };
const resultName = (label: string, sequence: number) => sequence === 1 ? label : `${label}-${sequence}`;

function wbImagePurpose(prompt: CanvasNodeData | undefined, nodes: CanvasNodeData[]) {
    const doc = (prompt?.metadata as ProductPromptMetadata | undefined)?.productImagePrompt;
    const parameter = nodes.find(node => node.id === doc?.parameterId)?.metadata as ProductVariantMetadata | undefined;
    if (!doc || parameter?.productPlatform !== WILDBERRIES_PLATFORM) return;
    const siblings = nodes.flatMap(node => {
        const item = (node.metadata as ProductPromptMetadata | undefined)?.productImagePrompt;
        return item?.parameterId === doc.parameterId ? [item] : [];
    });
    const angle = productPromptTitle({ ...doc, variantName: undefined }, siblings)
        .replace(/^(?:轮播图|富内容)(?:\s*\d+)?\s*[·：:]\s*/, "");
    const label = doc.kind === "main" ? "主图" : doc.kind === "carousel" ? `轮播图 · ${angle}` : doc.kind === "rich" ? `富内容 · ${angle}` : "";
    return label ? { label, parameterId: doc.parameterId, key: doc.key } : undefined;
}

const automaticName = (name: string | undefined, base: string | undefined) => Boolean(name && base && name.startsWith(base + "-")
    && /^\d+$/.test(name.slice(base.length + 1)));

function renameWBImageNodes(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const purposes = new Map(nodes.flatMap(node => {
        if (node.type !== CanvasNodeType.Image || !node.metadata?.generationType) return [];
        const purpose = wbImagePurpose(findGeneratedImageSourcePrompt(node, nodes, connections), nodes);
        return purpose ? [[node.id, { ...purpose, group: JSON.stringify([purpose.parameterId, purpose.key, (node.metadata as NamedMetadata).productVariant?.id || ""]) }] as const] : [];
    }));
    const next = new Map<string, number>();
    for (const node of nodes) {
        const purpose = purposes.get(node.id), saved = (node.metadata as NamedMetadata | undefined)?.wbImageNaming;
        if (purpose && saved && Number.isSafeInteger(saved.sequence) && saved.sequence > 0)
            next.set(purpose.group, Math.max(next.get(purpose.group) || 1, saved.sequence + Math.max(1, node.metadata?.images?.length || 0)));
    }
    let changed = false;
    const named = nodes.map(node => {
        const purpose = purposes.get(node.id);
        if (!purpose) return node;
        const metadata = node.metadata as NamedMetadata, previous = metadata.wbImageNaming;
        const autoTitle = previous ? node.title === resultName(previous.label, previous.sequence)
            : automaticName(node.title, metadata.generationNameBase) || node.title === metadata.prompt?.slice(0, 32);
        if (!autoTitle) return node;
        const sequence = previous?.sequence || next.get(purpose.group) || 1;
        next.set(purpose.group, Math.max(next.get(purpose.group) || 1, sequence + Math.max(1, metadata.images?.length || 0)));
        const title = resultName(purpose.label, sequence);
        const images = metadata.images?.map((image, index) => {
            const auto = !image.name || automaticName(image.name, metadata.generationNameBase)
                || previous && image.name === resultName(previous.label, previous.sequence + index);
            const name = auto ? resultName(purpose.label, sequence + index) : image.name;
            return name === image.name ? image : { ...image, name };
        });
        if (node.title === title && previous?.label === purpose.label && previous.sequence === sequence
            && !images?.some((image, index) => image !== metadata.images![index])) return node;
        changed = true;
        return { ...node, title, metadata: { ...metadata, generationNameBase: purpose.label,
            wbImageNaming: { label: purpose.label, sequence }, ...(images ? { images } : {}) } };
    });
    return changed ? named : nodes;
}

export function generatedImageCardTitle(promptNode?: CanvasNodeData): string {
    if (promptNode?.type === "guan:product-prompt") return "";
    const sourceLabel = String(promptNode?.metadata?.excelPromptLabel || promptNode?.title || "").trim();
    if (/主图/.test(sourceLabel)) return "主图";
    const detail = sourceLabel.match(/详情页(?:提示词)?\s*0*(\d+)/i);
    if (detail) return `详情页${String(Number(detail[1])).padStart(2, "0")}`;
    const rich = sourceLabel.match(/富内容(?:提示词)?\s*0*(\d+)/i);
    if (rich) return `富内容${String(Number(rich[1])).padStart(2, "0")}`;
    if (/视频提示词/i.test(sourceLabel)) return "视频";
    return "";
}

export function findGeneratedImageSourcePrompt(node: Pick<CanvasNodeData, "id">, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData | undefined {
    const incoming = connections.filter((connection) => connection.toNodeId === node.id);
    const directPrompt = incoming
        .map((connection) => nodes.find((candidate) => candidate.id === connection.fromNodeId))
        .find((candidate) => candidate?.type === CanvasNodeType.Text || candidate?.type === "guan:product-prompt");
    if (directPrompt) return directPrompt;
    const configIds = incoming
        .map((connection) => nodes.find((candidate) => candidate.id === connection.fromNodeId))
        .filter((candidate): candidate is CanvasNodeData => candidate?.type === CanvasNodeType.Config)
        .map((candidate) => candidate.id);
    return connections
        .filter((connection) => configIds.includes(connection.toNodeId))
        .map((connection) => nodes.find((candidate) => candidate.id === connection.fromNodeId))
        .find((candidate) => candidate?.type === CanvasNodeType.Text || candidate?.type === "guan:product-prompt");
}

export function renameGeneratedImageNodes(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData[] {
    const restored = renameWBImageNodes(restoreVariantImageNames(nodes), connections);
    return numberGeneratedImages(restored, (node: CanvasNodeData) => {
        if (!node.metadata?.generationType || (node.metadata as NamedMetadata).wbImageNaming) return "";
        const base = node.metadata.generationNameBase;
        // 已有自动编号只做兼容修复，不把用户改过的名称重新覆盖。
        if (base && (!node.title?.startsWith(base + "-") || !/^\d+$/.test(node.title.slice(base.length + 1)))) return "";
        return base || generatedImageCardTitle(findGeneratedImageSourcePrompt(node, restored, connections));
    });
}

