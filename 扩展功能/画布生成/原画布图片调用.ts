import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { prepareRoutedImageRequest, parseRoutedImageResponse, type PreparedImageRoute, type ImageRoute } from "../故障切换/图片路由请求";
import { type GeneratedImage } from "./原版图片协议";
import { runCanvasImageTask } from "./图片任务衔接.mjs";
import { bindConfiguredChannel } from "../生成网关/渠道绑定客户端";

export type CanvasImageTask = { taskId: string; slotId: string; binding: string; requestHash: string };
export type CanvasImageReceipt = { taskId: string; responseHash: string };
type Scope = { productId: string; nodeId: string; slotId: string };
type GenerationHost = {
  bind(profile: { kind: string; endpoint: string; value: string }): Promise<{ binding: string }>;
  createPlan(plan: PreparedImageRoute["plan"]): Promise<{ binding: string }>;
  describe(binding: string): Promise<{ binding: string; kind: string; endpoint: string }>;
};

export { bindImageChannel as bindGenerationChannel };

async function bindImageChannel(host: GenerationHost, config: AiConfig) {
  const channel = resolveModelRequestConfig(config, config.model || config.imageModel);
  return bindConfiguredChannel(host, channel);
}

export async function requestCanvasImage(options: {
  config: AiConfig; prompt: string; references?: ReferenceImage[]; scope: Scope;
  previous?: CanvasImageTask; signal?: AbortSignal; retry?: boolean;
  recordTask(task: CanvasImageTask): Promise<void>;
  applyAndSave(image: GeneratedImage, receipt: CanvasImageReceipt): Promise<void>;
}) {
  const host = (window as unknown as { __guanGenerationHost?: GenerationHost }).__guanGenerationHost;
  if (!host) throw new Error("本机生成端口尚未接入，请重新打开工作台；未改用浏览器直连。");
  const config = structuredClone({ ...options.config, count: "1" });
  const prompt = options.prompt, references = structuredClone(options.references || []);
  let prepared: PreparedImageRoute;
  await runCanvasImageTask({
    host, scope: options.scope, previous: options.previous, signal: options.signal, retry: options.retry,
    prepare: async () => { prepared = await prepareRoutedImageRequest(config, prompt, references, candidate => bindImageChannel(host, candidate)); return prepared.request; },
    bind: async () => (await host.createPlan(prepared.plan)).binding, recordTask: options.recordTask,
    applyAndSave: async (job: { bytes: string; routing?: ImageRoute }, receipt: CanvasImageReceipt) => {
      const image = parseRoutedImageResponse(config, job.bytes, job.routing)[0];
      // 远程URL需要另批受限媒体下载接入；不能绕过CSP保存未落盘的外网网址。
      if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(image.dataUrl))
        throw new Error("上游返回远程图片地址，本批尚未接入受限图片下载；响应已保留，请勿重复生成。");
      await options.applyAndSave(image, receipt);
    },
  });
}
