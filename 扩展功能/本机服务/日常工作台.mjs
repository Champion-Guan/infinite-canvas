import { requireValue } from '../本机存储/协议.mjs';
import { createMacOSMasterKeyProvider } from '../本机凭据/钥匙串主密钥.mjs';
import { startIsolatedAuthorizedWorkbench } from './受限工作台启动器.mjs';
import { dailyWorkbenchPaths, prepareDailyDataRoot } from './日常数据根.mjs';

// 仅为Web本机服务装配，不安装launchd、不接管既有进程、不打开默认浏览器。
// 2026-10-21开发模式：用户授权直接使用现有测试数据；启动、更新、正常停止无需逐次批准。
export async function startDailyWorkbench({ webRoot, storage, helperPath, helperSHA256,
  initialize = false, softwareUpdateOptions = {}, deferActivation = false } = {}) {
  requireValue(typeof initialize === 'boolean' && typeof storage?.openWorkspace === 'function' &&
    typeof storage?.startDataService === 'function', 'invalid_daily_config', '日常启动必须明确装配完整存储服务。');
  const paths = dailyWorkbenchPaths();
  const provider = createMacOSMasterKeyProvider({ helperPath, helperSHA256 });
  const guardedStorage = { ...storage, openWorkspace(options) {
    requireValue(options.dataRoot === paths.dataRoot && options.initialize === initialize,
      'invalid_daily_root', '日常工作区装配不一致，未打开数据库。');
    const dataRoot = prepareDailyDataRoot({ initialize });
    return storage.openWorkspace({ ...options, dataRoot });
  } };
  // 启动器先独占监听端口，再调用openWorkspace。端口冲突不创建数据、不读钥匙串。
  const app = await startIsolatedAuthorizedWorkbench({ webRoot, dataRoot: paths.dataRoot, initialize,
    storage: guardedStorage, credentialKeyProvider: provider, endpoint: { hostname: 'localhost', port: 3100 }, softwareUpdateOptions, deferActivation });
  return Object.freeze({ origin: app.origin, workspaceId: app.workspaceId, dataRoot: paths.dataRoot,
    getStatus: () => app.getStatus(),
    closeForUpdate: () => app.closeForUpdate(),
    activate: () => app.activate(),
    reloadWebBundle: () => app.reloadWebBundle(),
    async close() {
      return app.close();
    },
  });
}
