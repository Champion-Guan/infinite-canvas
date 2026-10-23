import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { AiTextMessage } from "@/services/api/image";
import { bindGenerationChannel, type CanvasImageTask, type CanvasImageReceipt } from "./原画布图片调用";
import { runCanvasImageTask } from "./图片任务衔接.mjs";
import { prepareTextRequest, parseTextResponse } from "./文本生成协议";

export async function requestCanvasText(options: {
    config: AiConfig; messages: AiTextMessage[];
    scope: { productId: string; nodeId: string; slotId: string };
    previous?: CanvasImageTask; signal?: AbortSignal; retry?: boolean;
    recordTask(task: CanvasImageTask): Promise<void>;
    applyAndSave(text: string, receipt: CanvasImageReceipt): Promise<void>;
}) {
    const host = (window as unknown as { __guanGenerationHost?: Parameters<typeof bindGenerationChannel>[0] }).__guanGenerationHost;
    if (!host) throw Error("本机生成端口尚未接入，请重新打开工作台；未改用浏览器直连。");
    const config = structuredClone(options.config);
    const channel = resolveModelRequestConfig(config, config.model || config.textModel);
    const request = prepareTextRequest(channel, structuredClone(options.messages));
    let result = "";
    await runCanvasImageTask({
        host, scope: options.scope, previous: options.previous, signal: options.signal, retry: options.retry,
        prepare: async () => request,
        bind: () => bindGenerationChannel(host, config),
        recordTask: options.recordTask,
        applyAndSave: async (job: { bytes: string }, receipt: CanvasImageReceipt) => {
            result = parseTextResponse(job.bytes);
            await options.applyAndSave(result, receipt);
        },
    });
    return result;
}
