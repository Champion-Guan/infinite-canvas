import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { createProxyConfigurationStore } from './代理配置存储.mjs';
import { buildIsolatedProxyConfig, subscriptionURL, validateSourceText } from './配置边界.mjs';
import { readProxySubscription } from './订阅读取.mjs';

// 只管理自己的实例。状态查询不发起网络探测；配置/启停串行，路由租约阻止中途换代理。
export async function openNetworkProxyService({ workspace, vault, runTrustedWrite, runtime, readSubscription = readProxySubscription } = {}) {
  requireValue(typeof runtime?.start === 'function' && typeof readSubscription === 'function', 'proxy_runtime_invalid', '代理服务需要可信进程内运行器。');
  const store = createProxyConfigurationStore({ workspace, vault, runTrustedWrite });
  let state = store.read(), handle = null, closed = false, pending = 0, leases = 0, tail = Promise.resolve(), lastError = null;
  const status = () => ({ configured: !!state.value.config, enabled: state.value.enabled, running: !!handle?.running(),
    configName: state.value.configName, source: state.value.config ? state.value.sourceKind === 'url' ? 'subscription' : 'uploaded' : null,
    busy: pending > 0, activeRequests: leases, lastError });
  const run = operation => {
    requireValue(!closed, 'proxy_closed', '代理服务已关闭。', 503);
    pending++;
    const flight = tail.then(async () => {
      requireValue(leases === 0, 'proxy_busy', '仍有请求使用代理，未中断或切换网络。', 409);
      try { const result = await operation(); lastError = null; return result; }
      catch (error) { lastError = lastError === 'proxy_restore_failed' ? lastError : error instanceof StorageError ? error.code : 'proxy_operation_failed'; throw new StorageError(lastError, '代理操作未确认，已重新检查实际保存状态；请检查配置、核心及端口，不要反复提交。', error instanceof StorageError ? error.status : 503); }
    }).finally(() => { pending--; });
    tail = flight.then(() => {}, () => {}); return flight;
  };
  async function stop() { if (handle) { await handle.stop(); handle = null; } }
  async function transition(next) {
    const before = state;
    lastError = null;
    await stop();
    try {
      if (next.enabled) handle = await runtime.start(await store.unseal(next.config));
      state = await store.save(next, before.revision); return status();
    } catch (error) {
      await stop();
      // 丢ACK可能已经提交。只按重新读到的真实落盘状态恢复，不伪称旧配置已回滚。
      state = store.read();
      if (state.value.enabled && state.value.config) { try { handle = await runtime.start(await store.unseal(state.value.config)); } catch { lastError = 'proxy_restore_failed'; } }
      throw error;
    }
  }
  async function configure({ configText, subscriptionUrl, fileName = '' }) {
    requireValue(typeof configText === 'string' && typeof subscriptionUrl === 'string' && !!configText.trim() !== !!subscriptionUrl.trim(), 'proxy_source_invalid', '请选择配置文件或订阅地址其中一种。');
    const sourceKind = configText.trim() ? 'text' : 'url', source = sourceKind === 'text' ? validateSourceText(configText) : subscriptionURL(subscriptionUrl.trim());
    const config = sourceKind === 'text' ? source : validateSourceText(await readSubscription(source));
    // 先验证再停旧进程。运行器会再次生成随机认证材料；这里只验证同一配置能安全装配。
    buildIsolatedProxyConfig(config, { port: 23210, controllerToken: '1'.repeat(64), proxyPassword: '2'.repeat(64) });
    const configName = sourceKind === 'url' ? '远端订阅配置' : fileName || '上传的代理配置.yaml';
    requireValue(!/https?:|[\r\n\0]/i.test(configName), 'proxy_source_invalid', '配置名称不能包含网址或控制字符。');
    const next = await store.prepare({ sourceKind, source, config, configName }); return transition(next);
  }
  if (state.value.enabled) {
    try { handle = await runtime.start(await store.unseal(state.value.config)); }
    catch { lastError = 'proxy_restore_failed'; } // 无代理不阻止打开画布，但后续代理请求必须失败，不能偷偷直连。
  }
  return Object.freeze({ status,
    configure: value => run(() => configure(value)),
    toggle: enabled => run(async () => {
      requireValue(typeof enabled === 'boolean' && state.value.config, 'proxy_not_configured', '请先保存代理配置。');
      return transition({ ...state.value, enabled });
    }),
    refresh: () => run(async () => {
      requireValue(state.value.sourceKind === 'url' && state.value.source, 'proxy_not_subscription', '当前不是订阅配置。');
      return configure({ configText: '', subscriptionUrl: await store.unseal(state.value.source) });
    }),
    async nodes() { requireValue(!closed && !pending && handle?.running(), 'proxy_not_running', '网络代理未运行。', 409); return handle.inspect(); },
    select: (group, name) => run(async () => { requireValue(handle?.running(), 'proxy_not_running', '网络代理未运行。', 409); return handle.select(group, name); }),
    async diagnose() {
      const lease = this.acquireRoute();
      try { return await handle.diagnose(); } finally { lease.release(); }
    },
    // 仅可信生成网关可获取认证材料；HTTP/浏览器不暴露此接口，后继批次才连接生成网关。
    acquireRoute(transport = 'proxy') {
      requireValue(!closed && !pending && (transport === 'proxy' && state.value.enabled && handle?.running() || transport === 'direct' && !state.value.enabled), 'proxy_not_running', '网络代理不可用，未改为直连。', 409);
      leases++; let released = false;
      return Object.freeze({ ...(transport === 'proxy' ? handle.route() : {}), release() { if (!released) { released = true; leases--; } } });
    },
    assertCanClose() { requireValue(pending === 0 && leases === 0, 'proxy_busy', '仍有代理配置或请求未结束，不能关闭。', 409); },
    async close() { this.assertCanClose(); closed = true; await stop(); },
  });
}
