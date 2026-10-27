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
  return Object.freeze({ handle, getStatus: tasks.getStatus,
    // stop前先检查；业务未决时不得先拆其他服务/密钥再把close失败吞掉。
    assertCanClose() { videos.assertCanClose(); const state = tasks.getStatus(); requireValue(state.running === 0 && state.unpersistedResults === 0, 'generation_busy', '仍有生成或未确认结果，不能关闭。', 409); },
    async assertCanUpdate() { tasks.assertCanUpdate(); videos.assertCanUpdate(); requireValue((await legacyVideos()).length === 0, 'install_tasks_pending', '旧画布仍有未核实的视频，请返回原画布查询。', 409); tasks.assertCanUpdate(); videos.assertCanUpdate(); },
    updateBlockers: async () => [...tasks.updateBlockers(), ...videos.updateBlockers(), ...await legacyVideos()],
    confirmNoResult: (id, acknowledgement) => videos.has(id) ? videos.confirmNoResult(id, acknowledgement) : tasks.confirmNoResult(id, acknowledgement),
    async close() { videos.assertCanClose(); await tasks.close(); await videos.close(); },
  });
}
