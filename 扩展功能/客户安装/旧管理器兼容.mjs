import { readState, versionPath } from './Web安装目录.mjs';
import { ownedProcess } from './管理进程身份.mjs';
import { prepareManagerHandoff } from './管理器版本接续.mjs';

export function continueLegacyManager({ app, manager, inventory, packageRoot, paths, stop }) {
  let flight = false, done = false, retryAt = 0;
  const timer = setInterval(async () => {
    if (flight || done || Date.now() < retryAt || !app.getStatus().ready) return;
    const authorization = app.getStatus().authorization;
    if (authorization?.authorizedPages !== 0 || authorization.pendingTickets !== 0 || authorization.activeRequests !== 0) return;
    flight = true;
    let watcher;
    try {
      const status = await manager.status();
      if (status.managerHandoff === true) { done = true; clearInterval(timer); return; }
      const state = await readState(paths.state), owner = await readState(paths.lock);
      if (state?.phase !== 'committed' || state.current?.version !== inventory.version || versionPath(paths, state.current) !== packageRoot.replace(/\/$/, '')) return;
      const expected = packageRoot.replace(/\/$/, '') + '/扩展功能/客户安装/Web客户命令.mjs supervisor';
      if (owner?.command?.endsWith(expected)) { done = true; clearInterval(timer); return; }
      if (owner?.pid !== process.ppid || !ownedProcess(owner)) return;
      watcher = await prepareManagerHandoff({ paths, owner, target: state.current, legacy: true, openProgress: !status.progressAvailable });
      // 冻结新页面、任务与保存的检查由新服务自己执行，旧管理器无法代替这道门禁。
      await app.closeForUpdate();
      done = true; clearInterval(timer); watcher.commit(); await stop(false);
    } catch (error) {
      watcher?.cancel();
      retryAt = Date.now() + 30000;
      console.error('管理器接续暂未完成：' + (error.code || 'update_manager_handoff_failed'));
    } finally { flight = false; }
  }, 1000);
  timer.unref();
  return () => { done = true; clearInterval(timer); };
}
