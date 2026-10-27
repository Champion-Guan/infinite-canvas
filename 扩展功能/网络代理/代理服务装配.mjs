import { createMihomoRuntime } from './内置代理运行.mjs';
import { openNetworkProxyService } from './代理服务.mjs';
import { createNetworkProxyHTTPHandler } from './代理HTTP入口.mjs';
import { 创建本地转发 } from './本地转发服务.mjs';

export async function assembleNetworkProxyService({ workspace, vault, runTrustedWrite, authorize, origin, runtimeOptions, initialConfiguration } = {}) {
  const runtime = createMihomoRuntime(runtimeOptions), proxy = await openNetworkProxyService({ workspace, vault, runTrustedWrite, runtime, initialConfiguration });
  return Object.freeze({ handle: createNetworkProxyHTTPHandler({ origin, authorize, proxy, relay: 创建本地转发({ proxy }) }), getStatus: proxy.status,
    assertCanClose: () => proxy.assertCanClose(), close: () => proxy.close(), acquireRoute: transport => proxy.acquireRoute(transport) });
}
