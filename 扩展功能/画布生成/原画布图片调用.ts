import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { prepareRoutedImageRequest, parseRoutedImageResponse, type PreparedImageRoute, type ImageRoute } from "../故障切换/图片路由请求";
import { type GeneratedImage } from "./原版图片协议";
import { runCanvasImageTask, imageRequestHash } from "./图片任务衔接.mjs";

export type CanvasImageTask = { taskId: string; slotId: string; binding: string; requestHash: string };
export type CanvasImageReceipt = { taskId: string; responseHash: string };
type Scope = { productId: string; nodeId: string; slotId: string };
type GenerationHost = {
  bind(profile: { kind: string; endpoint: string; value: string }): Promise<{ binding: string }>;
  createPlan(plan: PreparedImageRoute["plan"]): Promise<{ binding: string }>;
  describe(binding: string): Promise<{ kind: string; endpoint: string }>;
};
const bindings = new WeakMap<object, Map<string, Promise<string>>>();

export { bindImageChannel as bindGenerationChannel };

async function bindImageChannel(host: GenerationHost, config: AiConfig) {
  const channel = resolveModelRequestConfig(config, config.model || config.imageModel);
  if (!channel.apiKey.trim() || /^(?:provider:|secret:|guan-vault:)/.test(channel.apiKey))
    throw new Error("渠道凭据格式不兼容，请在原渠道设置中重新保存；没有将引用当作API Key发送。");
  // 兼容当前加密配置；本批不改配置编码，不宣称旧密钥已禁止页面回读。
  // 缓存只用摘要作键，不额外保留明文；不同地址/协议/密钥不会复用绑定。
  const key = await imageRequestHash({ kind: channel.apiFormat, endpoint: channel.baseUrl, value: channel.apiKey });
  let cache = bindings.get(host);
  if (!cache) { cache = new Map(); bindings.set(host, cache); }
  let flight = cache.get(key);
  if (!flight) {
    flight = host.bind({ kind: channel.apiFormat, endpoint: channel.baseUrl, value: channel.apiKey }).then(value => value.binding);
    cache.set(key, flight);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
    const current = cache;
    void flight.catch(() => { if (current.get(key) === flight) current.delete(key); });
  }
  return flight;
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
