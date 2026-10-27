import { spawn } from 'node:child_process';
import { open, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dailyWorkbenchPaths } from '../本机服务/日常数据根.mjs';
import { verifySignedWebDirectory } from './Web安装包核验.mjs';
import { webInstallPaths, privateDirectory, readState, writeState, versionPath } from './Web安装目录.mjs';
import { WEB_APP, fail } from './Web发布协议.mjs';
import { switchWebVersion } from './Web版本事务.mjs';
import { restoreWebStage, stageWebPackage, validateStageIdentity } from './Web暂存恢复.mjs';
import { 清理过期安装版本, 清理已完成Web安装 } from './安装版本清理.mjs';
import { 创建有界日志流 } from '../本机服务/有界运行日志.mjs';
import { webProgressSnapshot } from './Web更新进度服务.mjs';
import { createDetachedProgressObserver } from './独立更新观察.mjs';
import { prepareManagerHandoff } from './管理器版本接续.mjs';
import { processIdentity, ownedProcess } from './管理进程身份.mjs';
import { assertWebHealth, safeStartupDiagnostic, startupError } from './启动健康诊断.mjs';
import { clearInstallConfirmation, saveInstallConfirmation, restoreInstallConfirmation } from './本次安装确认.mjs';
export { processIdentity, ownedProcess } from './管理进程身份.mjs';

export async function runWebSupervisor(paths = webInstallPaths()) {
  await privateDirectory(paths.root); await privateDirectory(paths.versions);
  const log = 创建有界日志流(paths.log);
  let state = await readState(paths.state);
  if (state?.app !== WEB_APP || !['committed', 'rolled-back'].includes(state.phase)) fail('update_recovery_required');
  const managerVersion = JSON.parse(await readFile(new URL('../../工作台发布.json', import.meta.url))).version;
  const owner = processIdentity(process.pid), lock = await open(paths.lock, 'wx', 0o600);
  await lock.writeFile(JSON.stringify(owner)); await lock.sync(); await lock.close();
  let child = null, childStatus = null, childStopped = true, current = state.current, staged = null, installing = false, approved = false;
  let phase = 'idle', reason = null, targetVersion = null, timer, handingOff = false, diagnostic = state.diagnostic || null;
  const verify = identity => verifySignedWebDirectory(versionPath(paths, identity), { releaseVersion: identity.version });
  const save = async value => {
    state = { app: WEB_APP, ...value }; await writeState(paths.state, state);
    const ready = ['committed', 'rolled-back'].includes(state.phase) && childStatus?.ready === true && childStatus.version === state.current?.version;
    if (ready && child?.connected) {
      child.send({ type: 'web-service-activate' });
      const deadline = Date.now() + 10000;
      while ((!childStatus?.ready || childStatus.acceptingPages === false) && Date.now() < deadline && child?.connected) await new Promise(resolve => setTimeout(resolve, 20));
      assertWebHealth(childStatus, state.current, state.workspaceId, { active: true });
    }
    await writeState(paths.address, { owner, ready, origin: ready ? childStatus.origin : null, version: state.current?.version, workspaceId: state.workspaceId });
  };
  const canApprove = () => Boolean(staged && !installing && ['staged', 'deferred', 'blocked'].includes(phase) &&
    ['committed', 'rolled-back'].includes(state.phase));
  const status = () => ({ allowed: true, state: phase, currentVersion: current.version, targetVersion, reason, canApprove: canApprove(), progressAvailable: true, managerVersion, managerHandoff: true, diagnostic,
    waiting: { pages: childStatus?.authorization?.authorizedPages ?? null, tickets: childStatus?.authorization?.pendingTickets ?? null, requests: childStatus?.authorization?.activeRequests ?? null } });
  const progress = createDetachedProgressObserver(target => webProgressSnapshot(target, status(), {
    transaction: state, service: childStatus, alive: Boolean(child && child.connected && !childStopped),
  }), paths);
  let stageJob = null;
  async function stage(identity) {
    validateStageIdentity(identity, current);
    if (installing || !['committed', 'rolled-back'].includes(state.phase)) fail('update_stage_unavailable');
    const download = join(dailyWorkbenchPaths().dataRoot, 'software-updates/packages', identity.downloadId);
    staged = await stageWebPackage({ paths, workspaceId: state.workspaceId, current, identity, download });
    await clearInstallConfirmation(paths);
    phase = 'staged'; diagnostic = null; targetVersion = staged.next.version; reason = null; approved = false;
  }
  async function managerRequest(message) {
    const { operation, identity, acknowledgement } = message;
    if (operation === 'status') return status();
    if (operation === 'staged-identity') return staged?.identity || null;
    if (operation === 'progress-window') {
      if (!targetVersion || identity !== targetVersion) fail('update_progress_unavailable');
      return progress.open(targetVersion);
    }
    if (operation === 'stage') {
      if (stageJob) fail('update_stage_unavailable');
      stageJob = stage(identity); try { await stageJob; } finally { stageJob = null; }
    } else if (operation === 'approve') {
      if (!canApprove() || JSON.stringify(identity) !== JSON.stringify(staged.identity) || acknowledgement !== 'saved-and-all-tasks-ended') fail('install_operator_confirmation_required');
      const restored = await restoreWebStage(paths, state.workspaceId, current);
      if (!restored || JSON.stringify(restored) !== JSON.stringify(staged)) fail('update_stage_invalid');
      await saveInstallConfirmation(paths, state.workspaceId, current, staged);
      approved = true; phase = 'awaiting-browser-exit'; reason = 'install_browsers_running';
    } else if (operation === 'defer') {
      if (installing) fail('update_stage_unavailable');
      await clearInstallConfirmation(paths);
      approved = false; phase = 'deferred'; reason = null;
    } else fail('invalid_request');
    return status();
  }
  async function start(identity) {
    const verified = await verify(identity), packageRoot = versionPath(paths, identity);
    childStatus = null; childStopped = false;
    const proc = spawn(join(packageRoot, 'runtime/node'), [join(packageRoot, '扩展功能/客户安装/Web客户服务.mjs')], {
      cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', GUAN_WEB_PORT_POLICY: 'automatic-v1' } });
    proc.stdout.pipe(log, { end: false }); proc.stderr.pipe(log, { end: false });
    child = proc;
    return await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => finish(startupError('web_start_timeout')), 60000);
      const finish = (error, ready) => { if (settled) return; settled = true; clearTimeout(timeout); if (error) reject(error); else resolve(ready); };
      proc.on('message', value => {
        if (value?.type === 'web-service-ready') {
          childStatus = value.status;
          try { assertWebHealth(value.status, verified.inventory, state.workspaceId); } catch (error) { finish(error); return; }
          finish(null, value.status);
        } else if (value?.type === 'web-service-status') childStatus = value.status;
        else if (value?.type === 'web-service-stopped') childStopped = true;
        else if (value?.type === 'web-service-failed') { childStopped = value.cleaned === true; finish(startupError(value.error)); }
        else if (value?.type === 'web-manager-request' && typeof value.id === 'string') {
          void managerRequest(value).then(result => { if (proc.connected) proc.send({ type: 'web-manager-reply', id: value.id, result }); },
            error => { if (proc.connected) proc.send({ type: 'web-manager-reply', id: value.id, error: error.code || 'update_stage_failed' }); });
        }
      });
      proc.once('error', error => { childStopped = true; finish(error); });
      proc.once('exit', () => { if (child === proc) child = null; finish(startupError('web_service_exited')); });
    });
  }
  async function stop(update = true) {
    const proc = child;
    if (!proc) { if (!childStopped) fail('update_activation_unconfirmed'); return; }
    if (!proc.connected) fail('update_activation_unconfirmed');
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(Error('web_stop_timeout')), 30000);
      const message = value => { if (value?.type === 'web-service-stop-blocked') finish(Object.assign(Error(value.error), { code: value.error })); };
      const exited = () => finish(childStopped ? null : Error('web_stop_unconfirmed'));
      const finish = error => { clearTimeout(timeout); proc.off('message', message); proc.off('exit', exited); if (error) reject(error); else resolve(); };
      proc.on('message', message); proc.once('exit', exited); proc.send({ type: 'web-service-stop', update });
    });
  }
  try {
    await 清理过期安装版本(paths, { clearInterrupted: true });
    const ready = await start(current);
    assertWebHealth(ready, current, state.workspaceId);
    await save({ ...state, workspaceId: ready.workspaceId });
    const cleanupDownloads = async () => {
      try { await 清理已完成Web安装(paths, join(dailyWorkbenchPaths().dataRoot, 'software-updates/packages')); }
      catch (error) { log.write('更新包清理未完成：' + (error.code || 'download_storage_failed') + '\n'); }
    };
    await cleanupDownloads();
    try {
      staged = await restoreWebStage(paths, ready.workspaceId, current);
      if (staged) {
        targetVersion = staged.next.version;
        approved = await restoreInstallConfirmation(paths, ready.workspaceId, current, staged);
        phase = approved ? 'awaiting-browser-exit' : 'staged';
        reason = approved ? 'install_browsers_running' : null;
      }
    } catch (error) { phase = 'blocked'; reason = error.code || 'update_stage_invalid'; }
    timer = setInterval(() => {
      if (handingOff || !approved || installing || !staged || !childStatus?.ready || childStatus.authorization?.authorizedPages !== 0) return;
      if (childStatus.authorization.pendingTickets !== 0 || childStatus.authorization.activeRequests !== 0) { reason = 'install_pages_releasing'; return; }
      installing = true; approved = false;
      void switchWebVersion({ previous: current, target: staged.next, workspaceId: state.workspaceId, verify, save,
        stop: () => stop(true), start, report: next => { phase = next; reason = null; } })
        .then(async result => {
          current = result.current; reason = result.error || null; diagnostic = result.diagnostic || null; staged = null;
          await clearInstallConfirmation(paths);
          if (!result.rolledBack) {
            if (current.version !== managerVersion) await handoffManager();
            else await cleanupDownloads();
          }
        })
        .catch(error => { phase = 'blocked'; reason = error.code || 'update_activation_unconfirmed'; diagnostic = error.diagnostic || safeStartupDiagnostic(error); log.write('更新未完成：' + JSON.stringify({ reason, diagnostic }) + '\n'); })
        .finally(() => { installing = false; });
    }, 1000);
    async function handoffManager() {
      phase = 'restarting-manager'; handingOff = true;
      let watcher;
      try {
        watcher = await prepareManagerHandoff({ paths, owner, target: current });
        await stop(true);
        clearInterval(timer);
        await progress.close({ handoff: true });
        await unlink(paths.address).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await unlink(paths.lock);
        watcher.commit();
        log.end(); process.exit(0);
      } catch (error) { watcher?.cancel(); handingOff = false; throw error; }
    }
    const shutdown = async () => {
      if (installing || stageJob || handingOff) return;
      try { await stop(false); clearInterval(timer); await progress.close(); await unlink(paths.address).catch(e => { if (e.code !== 'ENOENT') throw e; }); await unlink(paths.lock); process.exit(0); }
      catch { reason = 'install_tasks_pending'; }
    };
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => void shutdown());
  } catch (error) {
    diagnostic = safeStartupDiagnostic(error);
    await writeState(paths.state, { ...state, diagnostic }).catch(() => {});
    log.write('安装管理器停止：' + JSON.stringify(diagnostic) + '\n');
    await progress.close();
    try { await stop(false); await unlink(paths.lock); } catch { /* 未确认退出时保留锁与事务 */ }
    throw error;
  }
}
