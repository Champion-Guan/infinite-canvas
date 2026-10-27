import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { startDailyWorkbench } from '../本机服务/日常工作台.mjs';
import { dailyWorkbenchPaths } from '../本机服务/日常数据根.mjs';
import { startDataService } from '../本机服务/数据服务.mjs';
import { openWorkspace } from '../本机存储/SQLite工作区.mjs';
import { copyStableHelper, webInstallPaths } from './Web安装目录.mjs';
import { createWebManagerClient } from './Web管理通信.mjs';
import { 清理更新缓存 } from '../软件更新/更新缓存限制.mjs';
import { WEB_MANIFEST_NAMES } from './Web发布协议.mjs';
import { continueLegacyManager } from './旧管理器兼容.mjs';
import { safeStartupDiagnostic } from './启动健康诊断.mjs';

if (!process.connected || process.argv.length !== 2) throw Error('Web客户服务必须由独立管理器启动。');
const root = fileURLToPath(new URL('../../', import.meta.url));
const inventory = JSON.parse(readFileSync(join(root, '工作台发布.json')));
const manager = createWebManagerClient();
let app, timer, cancelContinuity, stopping = false;
const send = message => { if (process.connected) process.send(message); };
try {
  const helper = await copyStableHelper(root, inventory);
  app = await startDailyWorkbench({ webRoot: join(root, 'web'), storage: { openWorkspace, startDataService }, ...helper,
    // beta3管理器仍校验3100；其升级事务完成后，下次由新版管理器启动即使用自动端口。
    ...(process.env.GUAN_WEB_PORT_POLICY === 'automatic-v1' ? {} : { endpoint: { hostname: 'localhost', port: 3100 } }),
    initialize: !existsSync(dailyWorkbenchPaths().dataRoot), deferActivation: true, softwareUpdateOptions: { webPackage: true, currentVersion: inventory.version, manager } });
  const status = () => ({ ...app.getStatus(), acceptingPages: app.getStatus().ready, workspaceId: app.workspaceId, version: inventory.version, origin: app.origin });
  send({ type: 'web-service-ready', status: { ...status(), ready: true, acceptingPages: false } });
  timer = setInterval(() => send({ type: 'web-service-status', status: status() }), 1000);
  const stop = async update => {
    if (stopping) return; stopping = true;
    try {
      if (update && app.getStatus().ready) await app.closeForUpdate(); else await app.close();
      clearInterval(timer); cancelContinuity?.(); manager.close(); send({ type: 'web-service-stopped' });
      process.disconnect();
    } catch (e) { stopping = false; send({ type: 'web-service-stop-blocked', error: e.code || 'install_tasks_pending' }); }
  };
  cancelContinuity = continueLegacyManager({ app, manager, inventory, packageRoot: root, paths: webInstallPaths(), stop });
  let cacheCleaned = false;
  process.on('message', value => { if (value?.type === 'web-service-stop') void stop(value.update === true); else if (value?.type === 'web-service-activate') {
    app.activate(); send({ type: 'web-service-status', status: status() });
    // 旧版管理器在线升级后仍在内存中运行；新服务收到提交后的激活消息即可补清下载包。
    if (!cacheCleaned) {
      cacheCleaned = true;
      void 清理更新缓存(join(dailyWorkbenchPaths().dataRoot, 'software-updates/packages'), { currentVersion: inventory.version, manifestNames: WEB_MANIFEST_NAMES, installedOnly: true })
        .catch(error => { cacheCleaned = false; console.error('已安装更新包清理未完成：' + (error.code || 'download_storage_failed')); });
    }
  } });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => void stop(false));
  process.on('disconnect', () => { void stop(false); });
} catch (e) {
  const diagnostic = safeStartupDiagnostic(e);
  send({ type: 'web-service-failed', error: diagnostic.code, diagnostic, cleaned: !(e instanceof AggregateError) });
  manager.close(); process.exitCode = 1;
  if (process.connected) process.disconnect();
}
