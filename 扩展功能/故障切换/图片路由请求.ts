import { fallbackModelsByCapability, resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { prepareOriginalImageRequest, parseOriginalImageResponse } from "../画布生成/原版图片协议";
import { imageRequestHash } from "../画布生成/图片任务衔接.mjs";
import { fallbackHost } from "./浏览器状态";

export type ImageRoute = { profileId: string; modelName: string; channelName: string; modelOption: string; kind: "openai" | "gemini"; endpoint: string; transport: "direct" | "proxy"; quality: string; size: string };
type PlanCandidate = { profileId: string; modelName: string; channelName: string; binding: string; requestHash: string; quality: string; size: string };
export type PreparedImageRoute = { request: Awaited<ReturnType<typeof prepareOriginalImageRequest>>; plan: { mode: "single" | "fallback"; capability: "image"; revision: number; candidates: PlanCandidate[] } };
export async function prepareRoutedImageRequest(config: AiConfig, prompt: string, references: ReferenceImage[], bind: (config: AiConfig) => Promise<string>): Promise<PreparedImageRoute> {
    const automatic = config.fallbackRequested === true && config.fallbackCapability === "image";
    const stored = await fallbackHost().read();
    const models = automatic ? fallbackModelsByCapability(config, "image") : [config.model || config.imageModel];
    if (!models.length || models.length > 32) throw new Error("Fallback未启用、没有可用勾选模型或超过32个候选；未改用其他渠道。");
    // 顺序准备，控制参考图/多协议编码的峰值内存；任一候选不兼容则发送前停止。
    const requests: Awaited<ReturnType<typeof prepareOriginalImageRequest>>[] = [], candidates: PlanCandidate[] = [];
    let bytes = 0;
    for (const model of models) {
        const candidate = { ...config, model, count: "1", fallbackRequested: false };
        const request = await prepareOriginalImageRequest(candidate, prompt, references);
        bytes += request.body.length;
        if (bytes > 31 * 1024 * 1024) throw new Error("Fallback多渠道请求合计超过本批限制；请减少候选或参考图，未发送请求。");
        const channel = resolveModelChannel(config, model), resolved = resolveModelRequestConfig(candidate, model);
        candidates.push({ profileId: channel.id, modelName: resolved.model, channelName: channel.name || channel.id,
            binding: await bind(candidate), requestHash: await imageRequestHash(request), quality: config.quality, size: config.size });
        requests.push(request);
    }
    const binary = new TextEncoder().encode(JSON.stringify({ format: "guan-routed-image-request.v1", requests }));
    if (binary.length > 32 * 1024 * 1024) throw new Error("切换任务超过32MiB，未发送请求。");
    let text = "";
    for (let offset = 0; offset < binary.length; offset += 32768) text += String.fromCharCode(...binary.subarray(offset, offset + 32768));
    return { request: { method: "POST", path: "/v1/images/generations", contentType: "application/json", body: btoa(text) },
        plan: { mode: automatic ? "fallback" : "single", capability: "image", revision: automatic ? stored.revision : 0, candidates } };
}
export function parseRoutedImageResponse(config: AiConfig, bytes: string, route?: ImageRoute | null) {
    if (!route) throw new Error("任务最终渠道记录缺失，原响应已保留；没有重新生成。");
    const restored: AiConfig = { ...config, quality: route.quality, size: route.size, model: route.modelOption, imageModel: route.modelOption,
        channels: [{ id: route.profileId, name: route.channelName, baseUrl: route.endpoint, apiKey: "", apiFormat: route.kind, models: [{ name: route.modelName, capability: "image" }] }] };
    return parseOriginalImageResponse(restored, bytes).map(image => ({ ...image, transport: route.transport }));
}
