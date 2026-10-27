import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { createProxyConfigurationStore } from './代理配置存储.mjs';
import { buildIsolatedProxyConfig, subscriptionURL, validateSourceText } from './配置边界.mjs';
import { readProxySubscription } from './订阅读取.mjs';
import { 代理配置来源显示 } from './内置订阅设置.mjs';
import { createSmartResourceUpdater } from './Smart资源自动更新.mjs';

// 只管理自己的实例。状态查询不发起网络探测；配置/启停串行，路由租约阻止中途换代理。
export async function openNetworkProxyService({ workspace, vault, runTrustedWrite, runtime, readSubscription = readProxySubscription, initialConfiguration, deferStartup = false, resourceUpdateOptions } = {}) {
  requireValue(typeof runtime?.start === 'function' && typeof readSubscription === 'function', 'proxy_runtime_invalid', '代理服务需要可信进程内运行器。');
  const store = createProxyConfigurationStore({ workspace, vault, runTrustedWrite });
  let state = store.read(), handle = null, closed = false, pending = 0, leases = 0, tail = Promise.resolve(), lastError = null;
  let currentNode = null, delayResults = [], configInput = '';
  let resourceUpdater, activeRuntime = runtime, activeCore = resourceUpdateOptions?.bundledCore, observation;
  async function updateSourceDisplay() {
    configInput = '';
    if (state.value.config) {
      let source = '';
      if (state.value.sourceKind === 'url') try { source = await store.unseal(state.value.source); } catch { /* 来源索引失败时不回传或猜测私人地址。 */ }
      configInput = 代理配置来源显示({ ...state.value, source });
    }
  }
  const status = () => ({ configured: !!state.value.config, enabled: state.value.enabled, relayEnabled: state.value.relayEnabled, running: !!handle?.running(), currentNode, delayResults,
    configName: state.value.configName, configInput, source: state.value.config ? state.value.sourceKind === 'url' ? 'subscription' : 'uploaded' : null,
    smart: handle?.running() ? { ...handle.smartStatus?.(), version: activeCore?.version, update: resourceUpdater?.status() } : null, resourceUpdate: resourceUpdater?.status() || null, busy: pending > 0, activeRequests: leases, lastError });
  const run = operation => {
    requireValue(!closed, 'proxy_closed', '代理服务已关闭。', 503);
    pending++;
    const flight = tail.then(async () => {
      requireValue(leases === 0, 'proxy_busy', '仍有请求使用代理，未中断或切换网络。', 409);
      try { lastError = null; return await operation(); }
      catch (error) { lastError = lastError === 'proxy_restore_failed' ? lastError : error instanceof StorageError ? error.code : 'proxy_operation_failed'; throw new StorageError(lastError, '代理操作未确认，已重新检查实际保存状态；请检查配置、核心及端口，不要反复提交。', error instanceof StorageError ? error.status : 503); }
    }).finally(() => { pending--; });
    tail = flight.then(() => {}, () => {}); return flight;
  };
  async function stop() { if (handle) { await handle.stop(); handle = null; } }
  async function startCore(source) {
    const candidate = await resourceUpdater?.candidate();
    if (!candidate) { handle = await activeRuntime.start(source); return; }
    try {
      const nextRuntime = resourceUpdateOptions.runtimeFactory(candidate); handle = await nextRuntime.start(source);
      requireValue(handle.smartStatus?.().enabled && handle.smartStatus().modelBundled, 'proxy_resource_activation_failed', 'Smart资源健康检查未通过。', 503);
      await resourceUpdater.accept(candidate); activeRuntime = nextRuntime; activeCore = candidate;
    } catch {
      await stop(); await resourceUpdater.reject(candidate); handle = await activeRuntime.start(source);
    }
  }
  async function transition(next) {
    const before = state;
    lastError = null;
    await stop();
    try {
      if (next.enabled && next.config) await startCore(await store.unseal(next.config));
      state = await store.save(next, before.revision); await updateSourceDisplay(); return status();
    } catch (error) {
      await stop();
      // 丢ACK可能已经提交。只按重新读到的真实落盘状态恢复，不伪称旧配置已回滚。
      state = store.read();
      await updateSourceDisplay();
      if (state.value.enabled && state.value.config) { try { await startCore(await store.unseal(state.value.config)); } catch { lastError = 'proxy_restore_failed'; } }
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
    const next = await store.prepare({ sourceKind, source, config, configName }); next.relayEnabled = state.value.relayEnabled; return transition(next);
  }
  const restore = async () => {
    if (!state.revision && initialConfiguration) {
      try {
        const initial = await initialConfiguration();
        if (initial) {
          if (initial.config != null || initial.source != null) {
            buildIsolatedProxyConfig(initial.config, { port: 23210, controllerToken: '1'.repeat(64), proxyPassword: '2'.repeat(64) });
            state = await store.save(await store.prepare(initial), 0);
          } else {
            // 旧状态可能只有开关，没有订阅或配置文件；只写入开关，不伪造空密文。
            requireValue(typeof initial.enabled === 'boolean' && typeof initial.relayEnabled === 'boolean', 'proxy_source_invalid', '代理开关状态无效。');
            state = await store.save({ ...state.value, enabled: initial.enabled, relayEnabled: initial.relayEnabled }, 0);
          }
        }
      } catch { state = store.read(); lastError = 'proxy_import_failed'; }
    }
    await updateSourceDisplay();
    if (state.value.enabled && state.value.config) {
      try { await startCore(await store.unseal(state.value.config)); }
      catch { lastError = 'proxy_restore_failed'; } // 无代理不阻止打开画布，但后续代理请求必须失败，不能偷偷直连。
    }
  };
  if (resourceUpdateOptions) {
    try {
      resourceUpdater = await createSmartResourceUpdater({ ...resourceUpdateOptions, proxy: { status, acquireRoute: () => port.acquireRoute(), core: () => activeCore },
        onPending: async () => {
          if (closed || pending || leases || !state.value.enabled || !state.value.config || !resourceUpdater.status().autoUpdate || resourceUpdater.status().state !== 'pending') return;
          await run(async () => {
            const source = await store.unseal(state.value.config);
            const selections = (await handle?.inspect?.() || []).filter(group => group.type === 'Selector' && group.selected);
            await stop(); await startCore(source);
            const groups = await handle.inspect?.() || [];
            for (const selection of selections) {
              const group = groups.find(item => item.name === selection.name && item.type === 'Selector');
              if (group?.choices.includes(selection.selected)) await handle.select(selection.name, selection.selected);
            }
          });
        } });
    } catch {
      // 保留异常状态文件供定位；更新器故障不能阻断原核心、画布或保存。
      const unavailable = () => { throw new StorageError('proxy_resource_state_invalid', '核心更新状态异常，已暂停资源更新；当前代理和工作台仍可使用。', 503); };
      resourceUpdater = { status: () => ({ autoUpdate: false, state: 'error', checkedAt: null, error: 'proxy_resource_state_invalid', model: 'large' }),
        candidate: async () => null, check: unavailable, configure: unavailable, start() {}, async close() {} };
    }
  }
  const port = Object.freeze({ status,
    async observeStatus() {
      const current = handle;
      if (closed || pending || !current?.running() || !current.observe) return status();
      if (!observation || observation.handle !== current) {
        const promise = Promise.resolve().then(() => current.observe()).catch(() => ({ observedAt: Date.now(), nodes: [], error: 'proxy_observation_failed' }));
        const request = { handle: current, promise }; observation = request;
        void promise.finally(() => { if (observation === request) observation = null; });
      }
      const live = await observation.promise;
      return { ...status(), ...(handle === current && !closed && !pending && current.running() ? { live } : {}) };
    },
    resourceCheck: async () => { await resourceUpdater?.check(true); return status(); },
    configureResourceUpdates: async enabled => { await resourceUpdater?.configure(enabled); return status(); },
    pauseUpdates: () => resourceUpdater?.close(),
    resumeUpdates: () => resourceUpdater?.start(),
    configure: value => run(() => configure(value)),
    toggle: enabled => run(async () => {
      requireValue(typeof enabled === 'boolean', 'proxy_source_invalid', '代理开关无效。');
      return transition({ ...state.value, enabled });
    }),
    toggleRelay: enabled => run(async () => {
      requireValue(typeof enabled === 'boolean', 'proxy_source_invalid', '本地代理开关无效。');
      state = await store.save({ ...state.value, relayEnabled: enabled }, state.revision); return status();
    }),
    refresh: () => run(async () => {
      requireValue(state.value.sourceKind === 'url' && state.value.source, 'proxy_not_subscription', '当前不是订阅配置。');
      return configure({ configText: '', subscriptionUrl: await store.unseal(state.value.source) });
    }),
    async nodes() { requireValue(!closed && !pending && handle?.running(), 'proxy_not_running', '网络代理未运行。', 409); return handle.inspect(); },
    select: (group, name) => run(async () => { requireValue(handle?.running(), 'proxy_not_running', '网络代理未运行。', 409); return handle.select(group, name); }),
    async diagnose() {
      const lease = this.acquireRoute();
      try { const result = await handle.diagnose(); currentNode = result.currentNode || { name: result.node, latencyMs: result.delay, testedAt: Date.now() }; return { ...result, ...status() }; } finally { lease.release(); }
    },
    async testAll() {
      const lease = this.acquireRoute();
      try { const result = await handle.testAll(); currentNode = result.currentNode; delayResults = result.delayResults; return status(); } finally { lease.release(); }
    },
    // 仅可信生成网关可获取认证材料；HTTP/浏览器不暴露此接口，后继批次才连接生成网关。
    acquireRoute(transport = 'proxy') {
      requireValue(!closed && !pending && (transport === 'proxy' && state.value.enabled && handle?.running() || transport === 'direct' && !state.value.enabled), 'proxy_not_running', '网络代理不可用，未改为直连。', 409);
      leases++; let released = false;
      return Object.freeze({ ...(transport === 'proxy' ? handle.route() : {}), release() { if (!released) { released = true; leases--; } } });
    },
    assertCanClose() { requireValue(pending === 0 && leases === 0, 'proxy_busy', '仍有代理配置或请求未结束，不能关闭。', 409); },
    async close() { await resourceUpdater?.close(); this.assertCanClose(); closed = true; await stop(); },
  });
  if (deferStartup) void run(restore).catch(() => {});
  else await restore();
  resourceUpdater?.start();
  return port;
}
