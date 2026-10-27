import { requireValue } from '../本机存储/协议.mjs';
import { createMacOSMasterKeyProvider } from '../本机凭据/钥匙串主密钥.mjs';
import { startIsolatedAuthorizedWorkbench } from './受限工作台启动器.mjs';
import { dailyWorkbenchPaths, prepareDailyDataRoot } from './日常数据根.mjs';
import { DEFAULT_WORKBENCH_PORT } from './工作台端口.mjs';
import { 定位代理核心 } from '../网络代理/代理核心定位.mjs';
import { 读取旧代理配置 } from '../网络代理/旧代理配置接续.mjs';
import { 读取默认代理配置 } from '../网络代理/默认代理配置.mjs';
import { 清理升级历史备份 } from './升级遗留清理.mjs';

// 仅为Web本机服务装配，不安装launchd、不接管既有进程、不打开默认浏览器。
// 2026-10-21开发模式：用户授权直接使用现有测试数据；启动、更新、正常停止无需逐次批准。
export async function startDailyWorkbench({ webRoot, storage, helperPath, helperSHA256,
  initialize = false, softwareUpdateOptions = {}, deferActivation = false,
  endpoint = { hostname: 'localhost', port: DEFAULT_WORKBENCH_PORT } } = {}) {
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
    storage: guardedStorage, credentialKeyProvider: provider, endpoint, softwareUpdateOptions, deferActivation,
    networkProxyOptions: { core: await 定位代理核心() }, initialProxyConfiguration: async () => await 读取旧代理配置() || 读取默认代理配置(),
    async onWorkspaceReady(workspace) {
      try {
        const result = await 清理升级历史备份({ dataRoot: paths.dataRoot, workspaceId: workspace.workspaceId });
        if (!result.alreadyCompleted) console.log('历史备份清理：' + result.removed + '份，保留未知项：' + result.skipped + '份。');
      } catch (error) { console.error('历史备份清理未完成，将在下次启动重试：' + (error.code || 'legacy_cleanup_failed')); }
    } });
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
