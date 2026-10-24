// 图片参数、尺寸规则和响应解析迁自锁定旧版；仅传输出口改接本机任务，不含自动收费重试。
import i18n from "@/i18n/index";
import { nanoid } from "nanoid";
import { resolveModelChannel, resolveModelRequestConfig, resolveModelScript, type AiConfig as BaseAiConfig } from "@/stores/use-config-store";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { imageToDataUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";
import { resolvePromptVariables } from "../提示词/变量使用规则";
import { imageSizePresets } from "../图片设置/图片尺寸规则";
type AiConfig = BaseAiConfig & { moderation?: string };

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};

type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};

type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    models?: Array<{ name?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};

export type GeneratedImage = {
    id: string;
    dataUrl: string;
    deliverySize?: string;
    upstreamSize?: string;
    channel?: string;
    channelId?: string;
    model?: string;
    transport?: "direct" | "proxy";
};

const IMAGE_QUALITY_VALUES = ["low", "medium", "high", "xhigh", "max"];

const DEFAULT_IMAGE_SHORT_SIDE = 1024;

const IMAGE_SIZE_STEP = 16;

const IMAGE_MIN_PIXELS = 655360;

const IMAGE_OUTPUT_FORMAT = "png";

const GEMINI_SUPPORTED_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];

function supportsAdvancedImageQuality(model: string) {
    const value = model.trim().toLowerCase();
    return /^(?:gpt-image-2\.5-(?:sunburst|flare))(?:-\d{4}-\d{2}-\d{2})?$/.test(value);
}

function normalizeQuality(quality: string, model = "") {
    const value = quality.trim().toLowerCase();
    if ((value === "xhigh" || value === "max") && !supportsAdvancedImageQuality(model)) return undefined;
    return IMAGE_QUALITY_VALUES.includes(value) ? value : undefined;
}

function normalizeBackground(background: string | undefined) {
    return background?.trim().toLowerCase() === "transparent" ? "transparent" : undefined;
}

function normalizeModeration(moderation: string | undefined) {
    return moderation?.trim().toLowerCase() === "low" ? "low" : "auto";
}

function resolveSize(ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const preset = imageSizePresets["1k"][ratio];
    if (preset) return preset;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    const shortSide = DEFAULT_IMAGE_SHORT_SIDE;
    const longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function parseRatioValue(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error(apiText("invalidImageSizeFormat"));
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error(apiText("positiveImageRatio"));
    return { width: w, height: h };
}

function parseImageRatio(value: string) {
    return parseRatioValue(value);
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    // Only validate the format locally; supported dimensions are decided by the provider.
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error(apiText("positiveImageDimensions"));
}

function ensureMinimumImagePixels(size: string) {
    // Keep the original ratio while satisfying the minimum pixels and 16px grid.
    const dimensions = parseImageDimensions(size);
    if (!dimensions) return size;
    if (Math.max(dimensions.width, dimensions.height) / Math.min(dimensions.width, dimensions.height) > 3) throw new Error("上游不支持超过 3:1 的图片比例，无法保持此比例生成");
    let a = dimensions.width;
    let b = dimensions.height;
    while (b) { const remainder = a % b; a = b; b = remainder; }
    const widthUnit = dimensions.width / a;
    const heightUnit = dimensions.height / a;
    // Coprime ratio units require a multiplier divisible by 16 for both edges.
    let multiplier = Math.ceil(Math.max(a, Math.ceil(Math.sqrt(IMAGE_MIN_PIXELS / (widthUnit * heightUnit)))) / 16) * 16;
    while (widthUnit * heightUnit * multiplier * multiplier < IMAGE_MIN_PIXELS) multiplier += 16;
    if (Math.max(widthUnit, heightUnit) * multiplier > 3840 || widthUnit * heightUnit * multiplier * multiplier > 8294400) throw new Error("无法仅通过等比例放大得到合法上游尺寸，请调整交付尺寸或比例（上游单边最多 3840、总像素最多 8294400）");
    return `${widthUnit * multiplier}x${heightUnit * multiplier}`;
}

function resolveRequestSize(_quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return ensureMinimumImagePixels(`${dimensions.width}x${dimensions.height}`);
    }
    if (value.includes(":")) return ensureMinimumImagePixels(resolveSize(value));
    throw new Error(apiText("invalidImageSizeFormat"));
}

function resolveGeminiImageConfig(config: AiConfig) {
    const value = resolveRequestSize(normalizeQuality(config.quality, config.model), config.size) || "";
    const dimensions = parseImageDimensions(value);
    const ratio = dimensions ? `${dimensions.width}:${dimensions.height}` : value;
    const aspectRatio = value && value.toLowerCase() !== "auto" ? closestGeminiAspectRatio(ratio) : undefined;
    const imageSize = resolveGeminiImageSize(dimensions);
    const image = { ...(aspectRatio ? { aspectRatio } : {}), ...(imageSize ? { imageSize } : {}) };
    return Object.keys(image).length ? { imageConfig: image } : {};
}

function closestGeminiAspectRatio(value: string) {
    const ratio = parseImageRatio(value);
    const target = ratio.width / ratio.height;
    return GEMINI_SUPPORTED_RATIOS.reduce((best, item) => {
        const current = parseRatioValue(item);
        const bestRatio = parseRatioValue(best);
        return Math.abs(current.width / current.height - target) < Math.abs(bestRatio.width / bestRatio.height - target) ? item : best;
    });
}

function resolveGeminiImageSize(dimensions: { width: number; height: number } | null) {
    if (!dimensions) return undefined;
    const size = `${dimensions.width}x${dimensions.height}`;
    const scale = Object.keys(imageSizePresets).find((key) => Object.values(imageSizePresets[key]).includes(size));
    if (scale) return scale.toUpperCase();
    const edge = Math.max(dimensions.width, dimensions.height);
    if (edge <= 768) return "512";
    if (edge <= 1536) return "1K";
    if (edge <= 3072) return "2K";
    return "4K";
}

function resolveImageSource(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
    }
    if (typeof item.url === "string" && item.url) {
        return item.url;
    }
    return null;
}

function parseImagePayload(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(payload.msg || apiText("requestFailed"));
    }
    // Support data, images, and results response fields used by different APIs.
    const imageList = payload.data
        || (payload as Record<string, unknown>).images as Array<Record<string, unknown>> | undefined
        || (payload as Record<string, unknown>).results as Array<Record<string, unknown>> | undefined
        || [];
    const images = imageList
        .map(resolveImageSource)
        .filter((value): value is string => Boolean(value))
        .map((dataUrl) => ({ id: nanoid(), dataUrl }));

    if (images.length === 0) {
        // Check whether the response contains data in an unrecognized format.
        const rawKeys = Object.keys(payload).filter((k) => k !== "code" && k !== "msg" && k !== "error");
        throw new Error(rawKeys.length > 0
            ? apiText("unknownImageResponse", { fields: rawKeys.join(", ") })
            : apiText("noImageReturned"));
    }

    return images;
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(apiText("geminiRejected", { reason: payload.promptFeedback.blockReason }));
}

function parseGeminiImagePayload(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const images =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => {
                const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
                if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
                return part.fileData?.fileUri || null;
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error(apiText("geminiNoImage"));
    return images;
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function attachRequestMetadata<T extends { id: string; dataUrl: string }>(images: T[], config: AiConfig, requestConfig: AiConfig, transport?: "direct" | "proxy"): GeneratedImage[] {
    const channel = resolveModelChannel(config, config.model || config.imageModel);
    return images.map((image) => ({
        ...image,
        deliverySize: config.size,
        upstreamSize: resolveRequestSize(normalizeQuality(config.quality, requestConfig.model), config.size),
        channel: channel.name,
        channelId: channel.id,
        model: requestConfig.model,
        ...(transport ? { transport } : {}),
    }));
}

export async function prepareOriginalImageRequest(config: AiConfig, prompt: string, references: ReferenceImage[] = []) {
    prompt = resolvePromptVariables(prompt);
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    // 原脚本关闭策略继续生效；不把脚本模型静默改为系统请求。
    if (resolveModelScript(config, config.model || config.imageModel)) throw new Error("自定义模型脚本已停用");
    const requestPrompt = references.length ? buildImageReferencePromptText(prompt, references) : prompt;
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    if (requestConfig.apiFormat === "gemini") {
        if (n !== 1) throw new Error("画布图片任务必须逐张登记，不能共用任务身份");
        const parts: GeminiPart[] = [{ text: requestPrompt }];
        for (const image of references) parts.push(toGeminiImagePart(await imageToDataUrl(image)));
        const systemText = requestConfig.systemPrompt.trim();
        const body = {
            ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
            generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...resolveGeminiImageConfig(requestConfig) },
            contents: [{ role: "user", parts }],
        };
        const model = requestConfig.model.trim().replace(/^models\//, "");
        if (!/^[\w.:-]+$/.test(model)) throw new Error("Gemini模型名称无效");
        const version = new URL(requestConfig.baseUrl).pathname.replace(/\/+$/, "").endsWith("/v1") ? "/v1" : "/v1beta";
        return encodeImageRequest(version + "/models/" + model + ":generateContent", body);
    }
    const quality = normalizeQuality(config.quality, requestConfig.model);
    const requestSize = resolveRequestSize(quality, config.size);
    const background = normalizeBackground(config.background);
    if (!references.length) {
        return encodeImageRequest("/v1/images/generations", {
            model: requestConfig.model,
            prompt: withSystemPrompt(requestConfig, requestPrompt), n,
            ...(quality ? { quality } : {}), ...(requestSize ? { size: requestSize } : {}),
            ...(background ? { background } : {}), moderation: normalizeModeration(config.moderation),
            ...(/gpt-image/.test(requestConfig.model) ? {} : { response_format: "b64_json" }),
            output_format: IMAGE_OUTPUT_FORMAT,
        });
    }
    const formData = new FormData();
    formData.set("model", requestConfig.model);
    formData.set("prompt", withSystemPrompt(requestConfig, requestPrompt));
    formData.set("n", String(n));
    if (!/gpt-image/.test(requestConfig.model)) formData.set("response_format", "b64_json");
    formData.set("output_format", IMAGE_OUTPUT_FORMAT);
    if (quality) formData.set("quality", quality);
    if (requestSize) formData.set("size", requestSize);
    if (background) formData.set("background", background);
    formData.set("moderation", normalizeModeration(config.moderation));
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    const imageField = files.length > 1 ? "image[]" : "image";
    files.forEach((file) => formData.append(imageField, file));
    return encodeImageRequest("/v1/images/edits", formData);
}
async function encodeImageRequest(path: string, body: object | FormData) {
    // Request只用于原生multipart编码，不发送网络，也不附加Authorization。
    const encoded = new Request("http://encoding.invalid", { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body),
        ...(body instanceof FormData ? {} : { headers: { "Content-Type": "application/json" } }) });
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    if (bytes.length > 32 * 1024 * 1024) throw new Error("图片请求超过32MiB，未发起生成");
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    let contentType = encoded.headers.get("content-type")!;
    if (body instanceof FormData) {
        const boundary = contentType.split("boundary=")[1];
        const pieces = binary.split(boundary);
        // 拒绝文件内容碰巧包含编码边界；不改写文件字节。
        if (pieces.length !== [...body.keys()].length + 2) throw new Error("参考图编码边界冲突，未提交");
        const canonical = pieces.join("guan-native-multipart-boundary");
        const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)))].map(value => value.toString(16).padStart(2, "0")).join("");
        const stable = "guan-image-" + digest;
        if (pieces.some(piece => piece.includes(stable))) throw new Error("参考图编码边界冲突，未提交");
        binary = pieces.join(stable); contentType = "multipart/form-data; boundary=" + stable;
    }
    return { method: "POST" as const, path, contentType, body: btoa(binary) };
}
export function parseOriginalImageResponse(config: AiConfig, bytes: string): GeneratedImage[] {
    const decoded = Uint8Array.from(atob(bytes), value => value.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("渠道图片响应无效");
    if (payload.error?.message) throw new Error(payload.error.message);
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const images = requestConfig.apiFormat === "gemini" ? parseGeminiImagePayload(payload) : parseImagePayload(payload);
    return attachRequestMetadata(images, config, requestConfig, "direct");
}
