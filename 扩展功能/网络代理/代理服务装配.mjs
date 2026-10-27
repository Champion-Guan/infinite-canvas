import { createMihomoRuntime } from './内置代理运行.mjs';
import { openNetworkProxyService } from './代理服务.mjs';
import { createNetworkProxyHTTPHandler } from './代理HTTP入口.mjs';
import { 创建本地转发 } from './本地转发服务.mjs';

export async function assembleNetworkProxyService({ workspace, vault, runTrustedWrite, authorize, origin, runtimeOptions, initialConfiguration, deferStartup = false, resourceUpdateOptions } = {}) {
  const runtime = createMihomoRuntime(runtimeOptions), proxy = await openNetworkProxyService({ workspace, vault, runTrustedWrite, runtime, initialConfiguration, deferStartup,
    ...(resourceUpdateOptions ? { resourceUpdateOptions: { ...resourceUpdateOptions, bundledCore: runtimeOptions.core, runtimeFactory: core => createMihomoRuntime({ ...runtimeOptions, core }) } } : {}) });
  return Object.freeze({ handle: createNetworkProxyHTTPHandler({ origin, authorize, proxy, relay: 创建本地转发({ proxy }) }), getStatus: proxy.status,
    pauseUpdates: () => proxy.pauseUpdates(), resumeUpdates: () => proxy.resumeUpdates(), assertCanClose: () => proxy.assertCanClose(), close: () => proxy.close(), acquireRoute: transport => proxy.acquireRoute(transport) });
}
