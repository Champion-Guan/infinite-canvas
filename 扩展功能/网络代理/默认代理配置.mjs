import { 内置网络代理订阅 } from './内置订阅设置.mjs';
import { readProxySubscription } from './订阅读取.mjs';

export async function 读取默认代理配置({ readSubscription = readProxySubscription } = {}) {
  return { sourceKind: 'url', source: 内置网络代理订阅, config: await readSubscription(内置网络代理订阅), configName: '远端订阅配置' };
}
