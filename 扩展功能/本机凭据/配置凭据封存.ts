import type { AiConfig } from '@/stores/use-config-store';
import type { ChannelBindingHost } from '../生成网关/渠道绑定客户端';
import { sealConfiguration } from './渠道编辑流程.mjs';

// 导入配置只在候选内封存新输入，原store在保存确认前不会持有新明文。
export async function sealConfigurationCredentials(config: AiConfig): Promise<AiConfig> {
  return sealConfiguration(config, () => {
    const host = (window as unknown as { __guanGenerationHost?: ChannelBindingHost }).__guanGenerationHost;
    if (!host) throw new Error('本机渠道服务尚未连接；原配置未改变。');
    return host;
  });
}
