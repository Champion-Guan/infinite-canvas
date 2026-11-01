import type { AiConfig } from "@/stores/use-config-store";
import { resolveModelChannel } from "@/stores/use-config-store";
import type { CanvasNodeData, CanvasNodeImage } from "@/types/canvas";

function clean(value: unknown) {
    if (typeof value !== "string") return "";
    const text = value.trim();
    return text && !/^(?:暂无|未知|渠道未知|模型未知|none|null|undefined)$/i.test(text) ? text : "";
}

/** 生成开始前就固定本次实际路由，供配置卡片和结果卡片共同显示。 */
export function resolveGenerationChannelMetadata(config: AiConfig) {
    const channel = resolveModelChannel(config, config.model || config.imageModel);
    return {
        channel: clean(channel.name) || clean(channel.id) || "当前渠道",
        channelId: clean(channel.id) || undefined,
    };
}

/**
 * 生成配置卡片的状态文案只读当前节点和当前模型路由。
 * 生成开始后优先使用实际尝试到的渠道；旧卡片没有渠道字段时，
 * 从配置快照解析渠道，避免显示“渠道未知”。
 */
export function configNodeGenerationStatus(node: CanvasNodeData, config: AiConfig, running: boolean) {
    const channel = clean(node.metadata?.channel)
        || clean(node.metadata?.provider)
        || clean(resolveGenerationChannelMetadata({ ...config, model: node.metadata?.model || config.model }).channel)
        || "当前渠道";
    if (running || node.metadata?.status === "loading") return `${channel} · 生成中`;
    if (node.metadata?.status === "error") return `${channel} · 生成失败`;
    if (node.metadata?.status === "success" && node.metadata?.generationStartedAt) return `${channel} · 已完成`;
    return `渠道：${channel}`;
}

/** 结果卡片使用生成开始时保存的实际渠道快照；兼容旧节点的模型编码。 */
export function resultNodeLoadingLabel(node: Pick<CanvasNodeData, "metadata">, generatingText: string, image?: CanvasNodeImage) {
    const metadata = node.metadata;
    const model = image?.model || metadata?.model || "";
    const encodedChannel = model.includes("::") ? model.slice(0, model.indexOf("::")) : "";
    const channel = clean(image?.channel)
        || clean(metadata?.channel)
        || clean(image?.channelId) || clean(metadata?.channelId) || encodedChannel;
    return channel ? `${channel} · ${generatingText}` : generatingText;
}
