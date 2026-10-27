import { bindConfiguredChannel, type ChannelBindingHost, type ChannelCredentials } from "./渠道绑定客户端";

type Host = ChannelBindingHost & { models(binding: string): Promise<string[]> };
export async function fetchConfiguredModels(channel: ChannelCredentials): Promise<string[]> {
    const host = (window as unknown as { __guanGenerationHost?: Host }).__guanGenerationHost;
    if (!host?.models) throw Error("本机模型读取尚未就绪，请重新打开工作台。");
    const models = await host.models(await bindConfiguredChannel(host, { ...channel }));
    if (!Array.isArray(models) || models.length > 10000 || models.some(name => typeof name !== "string" || !name || name.length > 512))
        throw Error("本机模型列表响应无效，请重试读取。");
    return models;
}
