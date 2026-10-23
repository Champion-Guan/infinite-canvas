import { createCanvasCheckpointReader } from '../画布生成/画布检查点.mjs';
import { createRoutedImageGateway } from '../故障切换/渠道切换网关.mjs';
import { requestThroughManagedProxy } from '../故障切换/受限代理传输.mjs';
import { requireValue } from '../本机存储/协议.mjs';
import { createProviderCredentialGateway } from './渠道凭据网关.mjs';
import { createGenerationHTTPHandler } from './生成HTTP入口.mjs';
import { openGenerationTasks } from '../生成任务/SQLite生成任务.mjs';
import { createSavedCanvasVerifier } from '../生成任务/画布保存核验.mjs';

// 自有边界。只依赖可信进程内端口，不打开数据库/监听端口/读取Keychain/重启服务。
export async function assembleGenerationService({ workspace, vault, runTrustedWrite, authorize, origin, networkProxy } = {}) {
  requireValue(typeof runTrustedWrite === 'function' && typeof authorize === 'function', 'invalid_generation_assembly', '生成装配需要既有写入协调与页面授权。');
  const coordinator = Object.freeze({ runWrite: operation => runTrustedWrite(operation) });
  const coordinatedVault = { read: ref => vault.read(ref), store: value => coordinator.runWrite(() => vault.store(value)) };
  const base = createProviderCredentialGateway({ workspace, vault: coordinatedVault, coordinator });
  const proxied = createProviderCredentialGateway({ workspace, vault: coordinatedVault, coordinator, requestBytes: async options => {
    const lease = options.route || networkProxy.acquireRoute();
    try { return await requestThroughManagedProxy({ ...options, route: lease }); } finally { if (!options.route) lease.release(); }
  } });
  const gateway = createRoutedImageGateway({ workspace, base, proxied, networkProxy, runTrustedWrite });
  const tasks = await openGenerationTasks({ workspace, gateway, coordinator, verifyApplied: createSavedCanvasVerifier({ workspace }) });
  const handle = createGenerationHTTPHandler({ origin, gateway, tasks, authorize, readCanvasCheckpoint: createCanvasCheckpointReader({ workspace, tasks }) });
  return Object.freeze({ handle, getStatus: tasks.getStatus,
    // stop前先检查；业务未决时不得先拆其他服务/密钥再把close失败吞掉。
    assertCanClose() { const state = tasks.getStatus(); requireValue(state.running === 0 && state.unpersistedResults === 0, 'generation_busy', '仍有生成或未确认结果，不能关闭。', 409); },
    assertCanUpdate: () => tasks.assertCanUpdate(),
    close: () => tasks.close(),
  });
}
