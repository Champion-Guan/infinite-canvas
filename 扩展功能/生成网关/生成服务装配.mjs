import { createLegacyVideoInventory } from '../生成任务/旧视频任务盘点.mjs';
import { openRemoteVideoLedger } from '../生成任务/视频远端任务账本.mjs';
import { createSavedVideoVerifier } from '../生成任务/视频结果保存核验.mjs';
import { createCanvasCheckpointReader } from '../画布生成/画布检查点.mjs';
import { createRoutedImageGateway } from '../故障切换/渠道切换网关.mjs';
import { requestThroughManagedProxy } from '../故障切换/受限代理传输.mjs';
import { requestProviderBytes } from './受限上游传输.mjs';
import { requireValue } from '../本机存储/协议.mjs';
import { createProviderCredentialGateway } from './渠道凭据网关.mjs';
import { createGenerationHTTPHandler } from './生成HTTP入口.mjs';
import { openGenerationTasks } from '../生成任务/SQLite生成任务.mjs';
import { createSavedCanvasVerifier } from '../生成任务/画布保存核验.mjs';
import { createProviderModelReader } from './渠道模型读取.mjs';
import { migrateLegacyChannelBindings } from '../本机凭据/旧渠道绑定迁移.mjs';

// 自有边界。只依赖可信进程内端口，不打开数据库/监听端口/读取Keychain/重启服务。
export async function assembleGenerationService({ workspace, vault, runTrustedWrite, authorize, origin, networkProxy } = {}) {
  requireValue(typeof runTrustedWrite === 'function' && typeof authorize === 'function', 'invalid_generation_assembly', '生成装配需要既有写入协调与页面授权。');
  const coordinator = Object.freeze({ runWrite: operation => runTrustedWrite(operation) });
  const coordinatedVault = { read: ref => vault.read(ref), store: value => coordinator.runWrite(() => vault.store(value)) };
  const base = createProviderCredentialGateway({ workspace, vault: coordinatedVault, coordinator, requestBytes: async options => {
    const enabled = networkProxy.getStatus().enabled, lease = options.route || networkProxy.acquireRoute(enabled ? 'proxy' : 'direct');
    try { return await (enabled ? requestThroughManagedProxy : requestProviderBytes)({ ...options, route: lease }); }
    finally { if (!options.route) lease.release(); }
  } });
  const proxied = createProviderCredentialGateway({ workspace, vault: coordinatedVault, coordinator, requestBytes: async options => {
    const lease = options.route || networkProxy.acquireRoute();
    try { return await requestThroughManagedProxy({ ...options, route: lease }); } finally { if (!options.route) lease.release(); }
  } });
  const gateway = createRoutedImageGateway({ workspace, base, proxied, networkProxy, runTrustedWrite });
  await migrateLegacyChannelBindings({ workspace, gateway: base, runWrite: coordinator.runWrite });
  const tasks = await openGenerationTasks({ workspace, gateway, coordinator, verifyApplied: createSavedCanvasVerifier({ workspace }) });
  const videos = openRemoteVideoLedger({ workspace, coordinator, gateway, verifySaved: createSavedVideoVerifier({ workspace }) });
  const legacyVideos = createLegacyVideoInventory({ workspace, isTracked: videos.isTracked });
  const models = createProviderModelReader({ gateway });
  const handle = createGenerationHTTPHandler({ origin, gateway, tasks, videos, models, authorize, readCanvasCheckpoint: createCanvasCheckpointReader({ workspace, tasks }) });
  const assertGenerationIdle = () => {
    videos.assertCanClose();
    const state = tasks.getStatus();
    requireValue(state.running === 0 && state.unpersistedResults === 0, 'generation_busy', '仍有生成或未确认结果，不能关闭。', 409);
  };
  const runSaveRetryBatch = async targets => {
    const results = [];
    for (const target of targets) {
      try { await tasks.retryResultSave(target.id); results.push({ id: target.id, ok: true }); }
      catch (error) {
        results.push({ id: target.id, ok: false, code: /^[a-z][a-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'task_action_failed' });
      }
    }
    return { total: results.length, completed: results.filter(result => result.ok).length, failures: results.filter(result => !result.ok) };
  };
  return Object.freeze({ handle, getStatus: tasks.getStatus,
    // stop前先检查；业务未决时不得先拆其他服务/密钥再把close失败吞掉。
    assertCanClose: assertGenerationIdle,
    // 升级停机阶段会继续由 close() 检查正在发送的请求和进程内未落盘结果。
    // 已落盘但尚未回写画布、或等待视频核实时，只保留账本与恢复能力，不阻塞版本切换。
    async assertCanUpdate() { assertGenerationIdle(); },
    updateBlockers: async () => [...tasks.updateBlockers(), ...videos.updateBlockers(), ...await legacyVideos()],
    taskSummary: () => tasks.taskSummary(),
    retryResultSaveBatch() {
      const targets = tasks.updateBlockers().filter(item => item.canRetryResultSave);
      return runSaveRetryBatch(targets);
    },
    async close() { videos.assertCanClose(); await tasks.close(); await videos.close(); },
  });
}
