import { readProxyState, runtimePaths } from '../软件更新/runtime-paths.mjs';

// 首次建立新项目代理记录时接续本用户原配置；只交给加密保管，不回传订阅或节点密码。
export async function 读取旧代理配置() {
  const value = await readProxyState(runtimePaths().proxyStateFile);
  if (!value) return null;
  // 即使旧版本没有保存过订阅，也要把客户已经选择的开关接续到新工作区。
  if (!value.cachedConfig || !value.source) return { enabled: value.enabled, relayEnabled: value.relayEnabled };
  return { sourceKind: value.source.kind, source: value.source.value, config: value.cachedConfig,
    configName: value.configName || (value.source.kind === 'url' ? '远端订阅配置' : '上传的代理配置.yaml'),
    // 首次接续旧运行时配置时，必须保留客户已经选择的两个开关状态。
    // 缺失字段只可能来自旧格式，交给配置存储的默认值处理。
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(typeof value.relayEnabled === 'boolean' ? { relayEnabled: value.relayEnabled } : {}),
  };
}
