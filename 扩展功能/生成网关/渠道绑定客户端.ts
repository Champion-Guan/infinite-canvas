import { bindChannelConfiguration } from "../本机凭据/页面凭据引用.mjs";
export type ChannelBindingHost = { bind(profile: { kind: string; endpoint: string; value: string }): Promise<{ binding: string }>; describe(binding: string): Promise<{ binding: string; kind: string; endpoint: string }>; previewCredential?(binding: string): Promise<{ binding: string; maskedKey: string }> };
export type ChannelCredentials = { apiFormat: string; baseUrl: string; apiKey: string };

export async function bindConfiguredChannel(host: ChannelBindingHost, channel: ChannelCredentials) {
    return bindChannelConfiguration(host, channel);
}
