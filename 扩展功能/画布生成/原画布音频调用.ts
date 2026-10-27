import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { requireGenerationMode } from "../产品配置/精简与离线策略";
import { bindGenerationChannel, type CanvasImageTask, type CanvasImageReceipt } from "./原画布图片调用";
import { runCanvasImageTask } from "./图片任务衔接.mjs";

export function prepareAudioRequest(config: AiConfig, prompt: string) {
    if (config.apiFormat === "gemini") throw Error("当前音频协议不支持Gemini渠道。");
    const payload = { model: config.model, input: prompt, voice: normalizeAudioVoiceValue(config.audioVoice),
        response_format: normalizeAudioFormatValue(config.audioFormat), speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
        ...(config.audioInstructions.trim() ? { instructions: config.audioInstructions.trim() } : {}) };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { method: "POST" as const, path: "/v1/audio/speech", contentType: "application/json", body: btoa(binary) };
}

export function parseAudioResponse(bytes: string, contentType: string, format: string) {
    if (!/^(?:audio\/|application\/octet-stream(?:;|$))/i.test(contentType)) throw Error("渠道没有返回音频文件，响应保留在任务账本，请勿重复生成。");
    const data = Uint8Array.from(atob(bytes), character => character.charCodeAt(0));
    if (!data.length) throw Error("渠道返回了空音频，未标记生成成功。");
    return new Blob([data], { type: /^audio\//i.test(contentType) ? contentType : audioMimeType(normalizeAudioFormatValue(format)) });
}

export async function requestCanvasAudio(options: {
    config: AiConfig; prompt: string; scope: { productId: string; nodeId: string; slotId: string };
    previous?: CanvasImageTask; signal?: AbortSignal; retry?: boolean;
    recordTask(task: CanvasImageTask): Promise<void>;
    applyAndSave(audio: Blob, receipt: CanvasImageReceipt): Promise<void>;
}) {
    requireGenerationMode("audio");
    const host = (window as unknown as { __guanGenerationHost?: Parameters<typeof bindGenerationChannel>[0] }).__guanGenerationHost;
    if (!host) throw Error("本机生成端口尚未就绪，未发送音频请求。");
    const config = structuredClone(options.config), channel = resolveModelRequestConfig(config, config.model || config.audioModel);
    await runCanvasImageTask({ host, scope: options.scope, previous: options.previous, signal: options.signal, retry: options.retry,
        prepare: async () => prepareAudioRequest(channel, options.prompt), bind: () => bindGenerationChannel(host, { ...config, model: config.model || config.audioModel }),
        recordTask: options.recordTask,
        applyAndSave: async (job: { bytes: string; result: { contentType: string } }, receipt: CanvasImageReceipt) => {
            await options.applyAndSave(parseAudioResponse(job.bytes, job.result.contentType, config.audioFormat), receipt);
        },
    });
}
