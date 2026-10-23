import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { startDailyWorkbench } from '../本机服务/日常工作台.mjs';
import { dailyWorkbenchPaths } from '../本机服务/日常数据根.mjs';
import { startDataService } from '../本机服务/数据服务.mjs';
import { openWorkspace } from '../本机存储/SQLite工作区.mjs';
import { copyStableHelper } from './Web安装目录.mjs';
import { createWebManagerClient } from './Web管理通信.mjs';

if (!process.connected || process.argv.length !== 2) throw Error('Web客户服务必须由独立管理器启动。');
const root = fileURLToPath(new URL('../../', import.meta.url));
const inventory = JSON.parse(readFileSync(join(root, '工作台发布.json')));
const helper = await copyStableHelper(root, inventory), manager = createWebManagerClient();
let app, timer, stopping = false;
const send = message => { if (process.connected) process.send(message); };
try {
  app = await startDailyWorkbench({ webRoot: join(root, 'web'), storage: { openWorkspace, startDataService }, ...helper,
    initialize: !existsSync(dailyWorkbenchPaths().dataRoot), deferActivation: true, softwareUpdateOptions: { webPackage: true, currentVersion: inventory.version, manager } });
  const status = () => ({ ...app.getStatus(), workspaceId: app.workspaceId, version: inventory.version, origin: app.origin });
  send({ type: 'web-service-ready', status: { ...status(), ready: true, acceptingPages: false } });
  timer = setInterval(() => send({ type: 'web-service-status', status: status() }), 1000);
  const stop = async update => {
    if (stopping) return; stopping = true;
    try {
      if (update && app.getStatus().ready) await app.closeForUpdate(); else await app.close();
      clearInterval(timer); manager.close(); send({ type: 'web-service-stopped' });
      process.disconnect();
    } catch (e) { stopping = false; send({ type: 'web-service-stop-blocked', error: e.code || 'install_tasks_pending' }); }
  };
  process.on('message', value => { if (value?.type === 'web-service-stop') void stop(value.update === true); else if (value?.type === 'web-service-activate') { app.activate(); send({ type: 'web-service-status', status: status() }); } });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => void stop(false));
  process.on('disconnect', () => { void stop(false); });
} catch (e) {
  send({ type: 'web-service-failed', error: e.code || 'web_start_failed', cleaned: !(e instanceof AggregateError) });
  manager.close(); process.exitCode = 1;
  if (process.connected) process.disconnect();
}
