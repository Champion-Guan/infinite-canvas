import { createMihomoRuntime } from './内置代理运行.mjs';
import { openNetworkProxyService } from './代理服务.mjs';
import { createNetworkProxyHTTPHandler } from './代理HTTP入口.mjs';

export async function assembleNetworkProxyService({ workspace, vault, runTrustedWrite, authorize, origin, runtimeOptions } = {}) {
  const runtime = createMihomoRuntime(runtimeOptions), proxy = await openNetworkProxyService({ workspace, vault, runTrustedWrite, runtime });
  return Object.freeze({ handle: createNetworkProxyHTTPHandler({ origin, authorize, proxy }), getStatus: proxy.status,
    assertCanClose: () => proxy.assertCanClose(), close: () => proxy.close(), acquireRoute: transport => proxy.acquireRoute(transport) });
}
