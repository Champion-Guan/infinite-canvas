import { spawn, execFileSync } from 'node:child_process';
import { open, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { dailyWorkbenchPaths } from '../本机服务/日常数据根.mjs';
import { compareVersions } from '../软件更新/stable-version.mjs';
import { verifySignedWebDirectory, extractSignedWebPackage } from './Web安装包核验.mjs';
import { webInstallPaths, privateDirectory, readState, writeState, versionPath, versionIdentity } from './Web安装目录.mjs';
import { WEB_APP, WEB_REPOSITORY, exact, fail } from './Web发布协议.mjs';
import { switchWebVersion } from './Web版本事务.mjs';

export function processIdentity(pid) {
  try { return { pid, command: execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim(),
    started: execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim() }; } catch { return null; }
}
export function ownedProcess(record) {
  if (!Number.isSafeInteger(record?.pid)) return false;
  const current = processIdentity(record.pid);
  return current && current.command === record.command && current.started === record.started;
}
export async function runWebSupervisor(paths = webInstallPaths()) {
  await privateDirectory(paths.root); await privateDirectory(paths.versions);
  let state = await readState(paths.state);
  if (state?.app !== WEB_APP || !['committed', 'rolled-back'].includes(state.phase)) fail('update_recovery_required');
  const lock = await open(paths.lock, 'wx', 0o600);
  await lock.writeFile(JSON.stringify(processIdentity(process.pid))); await lock.sync(); await lock.close();
  let child = null, childStatus = null, childStopped = true, current = state.current, staged = null, installing = false, approved = false;
  let phase = 'idle', reason = null, targetVersion = null, timer;
  const verify = identity => verifySignedWebDirectory(versionPath(paths, identity), { releaseVersion: identity.version });
  const save = async value => { state = { app: WEB_APP, ...value }; await writeState(paths.state, state); if (['committed', 'rolled-back'].includes(state.phase) && child?.connected) child.send({ type: 'web-service-activate' }); };
  const status = () => ({ allowed: true, state: phase, currentVersion: current.version, targetVersion, reason });
  let stageJob = null;
  async function stage(identity) {
    if (!exact(identity, ['repository', 'version', 'downloadId']) || identity.repository !== WEB_REPOSITORY ||
      !/^verified-[a-f0-9-]{36}$/.test(identity.downloadId) || compareVersions(identity.version, current.version) <= 0) fail('update_stage_invalid');
    if (installing) fail('update_stage_unavailable');
    if (staged?.identity.downloadId === identity.downloadId) return;
    const download = join(dailyWorkbenchPaths().dataRoot, 'software-updates/packages', identity.downloadId);
    const info = await lstat(download);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077) fail('update_stage_invalid');
    const destination = join(paths.versions, '暂存-' + identity.downloadId);
    const verified = await extractSignedWebPackage(download, destination, { repository: WEB_REPOSITORY, releaseVersion: identity.version, currentVersion: current.version });
    const next = versionIdentity(verified.inventory);
    // 实际路径由固定版本身份决定，暂存成功后移动；不执行新代码。
    const { rename } = await import('node:fs/promises');
    await rename(destination, versionPath(paths, next));
    staged = { identity, next }; phase = 'staged'; targetVersion = next.version; reason = null; approved = false;
  }
  async function managerRequest(message) {
    const { operation, identity, acknowledgement } = message;
    if (operation === 'status') return status();
    if (operation === 'stage') {
      if (stageJob) fail('update_stage_unavailable');
      stageJob = stage(identity); try { await stageJob; } finally { stageJob = null; }
    } else if (operation === 'approve') {
      if (!staged || JSON.stringify(identity) !== JSON.stringify(staged.identity) || acknowledgement !== 'saved-and-all-tasks-ended' || installing) fail('install_operator_confirmation_required');
      approved = true; phase = 'awaiting-browser-exit'; reason = 'install_browsers_running';
    } else if (operation === 'defer') {
      if (installing) fail('update_stage_unavailable');
      approved = false; phase = 'deferred'; reason = null;
    } else fail('invalid_request');
    return status();
  }
  async function start(identity) {
    const verified = await verify(identity), packageRoot = versionPath(paths, identity);
    childStatus = null; childStopped = false;
    const proc = spawn(join(packageRoot, 'runtime/node'), [join(packageRoot, '扩展功能/客户安装/Web客户服务.mjs')], {
      cwd: packageRoot, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
    child = proc;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('web_start_timeout')), 60000);
      const finish = (error, ready) => { clearTimeout(timeout); if (error) reject(error); else resolve(ready); };
      proc.on('message', value => {
        if (value?.type === 'web-service-ready') {
          childStatus = value.status;
          if (value.status?.version !== verified.inventory.version) { finish(Error('web_health_mismatch')); return; }
          finish(null, value.status);
        } else if (value?.type === 'web-service-status') childStatus = value.status;
        else if (value?.type === 'web-service-stopped') childStopped = true;
        else if (value?.type === 'web-service-failed') { childStopped = value.cleaned === true; finish(Error(value.error)); }
        else if (value?.type === 'web-manager-request' && typeof value.id === 'string') {
          void managerRequest(value).then(result => { if (proc.connected) proc.send({ type: 'web-manager-reply', id: value.id, result }); },
            error => { if (proc.connected) proc.send({ type: 'web-manager-reply', id: value.id, error: error.code || 'update_stage_failed' }); });
        }
      });
      proc.once('error', error => { childStopped = true; finish(error); });
      proc.once('exit', () => { if (child === proc) child = null; finish(Error('web_service_exited')); });
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
    const ready = await start(current);
    if (state.workspaceId && state.workspaceId !== ready.workspaceId) fail('web_health_mismatch');
    await save({ ...state, workspaceId: ready.workspaceId });
    timer = setInterval(() => {
      if (!approved || installing || !staged || !childStatus?.ready || childStatus.authorization?.authorizedPages !== 0) return;
      installing = true; approved = false;
      void switchWebVersion({ previous: current, target: staged.next, workspaceId: state.workspaceId, verify, save,
        stop: () => stop(true), start, report: next => { phase = next; reason = null; } })
        .then(result => { current = result.current; reason = result.error || null; staged = null; })
        .catch(error => { phase = 'blocked'; reason = error.code || 'update_activation_unconfirmed'; })
        .finally(() => { installing = false; });
    }, 1000);
    const shutdown = async () => {
      if (installing || stageJob) return;
      try { await stop(false); clearInterval(timer); await unlink(paths.lock); process.exit(0); }
      catch { reason = 'install_tasks_pending'; }
    };
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => void shutdown());
  } catch (error) {
    try { await stop(false); await unlink(paths.lock); } catch { /* 未确认退出时保留锁与事务 */ }
    throw error;
  }
}
