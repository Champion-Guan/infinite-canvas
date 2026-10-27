import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webInstallPaths, readState, writeState, versionPath } from './Web安装目录.mjs';
import { verifySignedWebDirectory } from './Web安装包核验.mjs';
import { ownedProcess } from './管理进程身份.mjs';
import { waitWebAddress } from './Web运行地址.mjs';
import { safeStartupDiagnostic, startupError } from './启动健康诊断.mjs';
import { createDetachedProgressObserver } from './独立更新观察.mjs';

const pause = () => new Promise(resolve => setTimeout(resolve, 200));
export async function waitManagerRelease(paths, owner, { timeout = 35000 } = {}) {
  const deadline = Date.now() + timeout;
  do {
    const running = await readState(paths.lock);
    if (!running && !ownedProcess(owner)) return;
    if (running && (running.pid !== owner.pid || running.started !== owner.started || running.command !== owner.command)) throw startupError('update_manager_handoff_failed');
    await pause();
  } while (Date.now() < deadline);
  throw startupError('update_manager_handoff_timeout');
}
export async function startCommittedManager(paths, target, { timeout = 65000 } = {}) {
  if (await readState(paths.lock)) throw startupError('update_manager_handoff_failed');
  const state = await readState(paths.state);
  if (!['committed', 'rolled-back'].includes(state?.phase) || JSON.stringify(state.current) !== JSON.stringify(target)) throw startupError('update_manager_handoff_failed');
  const root = versionPath(paths, target);
  await verifySignedWebDirectory(root, { releaseVersion: target.version });
  const proc = spawn(join(root, 'runtime/node'), [join(root, '扩展功能/客户安装/Web客户命令.mjs'), 'supervisor'], {
    cwd: root, detached: true, stdio: 'ignore', env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
  });
  proc.unref();
  return waitWebAddress(paths, ownedProcess, { timeout });
}

// 只接受可信父进程的IPC；不提供网页命令、路径参数、自动授权码或强杀功能。
export async function prepareManagerHandoff({ paths = webInstallPaths(), owner, target, legacy = false, openProgress = false }) {
  const proc = spawn(process.execPath, [fileURLToPath(import.meta.url)], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { proc.kill('SIGTERM'); reject(startupError('update_manager_handoff_timeout')); }, 10000);
    proc.once('error', error => { clearTimeout(timeout); reject(error); });
    proc.once('exit', () => { clearTimeout(timeout); reject(startupError('update_manager_handoff_failed')); });
    proc.once('message', message => { clearTimeout(timeout); if (message?.type === 'web-handoff-ready') resolve(message); else reject(startupError('update_manager_handoff_failed')); });
    proc.send({ type: 'web-handoff-prepare', paths, owner, target, legacy, openProgress });
  });
  return {
    url: ready.url,
    commit() { if (proc.connected) proc.send({ type: 'web-handoff-commit' }); proc.unref(); proc.channel?.unref(); },
    cancel() { if (proc.connected) proc.send({ type: 'web-handoff-cancel' }); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.connected) {
  let prepared, monitor, committed = false, phase = 'restarting-manager', diagnostic = null;
  const timer = setTimeout(() => process.exit(1), 15000);
  process.on('message', async message => {
    if (message?.type === 'web-handoff-cancel') { await monitor?.close(); process.exit(0); }
    if (message?.type === 'web-handoff-prepare' && !prepared) {
      try {
        const state = await readState(message.paths.state), owner = await readState(message.paths.lock);
        if (!ownedProcess(message.owner) || JSON.stringify(owner) !== JSON.stringify(message.owner) ||
          state?.phase !== 'committed' || JSON.stringify(state.current) !== JSON.stringify(message.target)) throw startupError('update_manager_handoff_failed');
        await verifySignedWebDirectory(versionPath(message.paths, message.target), { releaseVersion: message.target.version });
        prepared = message;
        if (message.openProgress) {
          monitor = createDetachedProgressObserver(target => ({ target, state: phase, diagnostic, origin: null }), message.paths);
        }
        const result = monitor ? await monitor.open(message.target.version) : {};
        process.send({ type: 'web-handoff-ready', ...result });
        if (result.url) spawn('/usr/bin/open', [result.url], { stdio: 'ignore' }).unref();
      } catch { process.send({ type: 'web-handoff-failed' }); process.exitCode = 1; }
    } else if (message?.type === 'web-handoff-commit' && prepared && !committed) {
      committed = true; clearTimeout(timer);
      const { paths, owner, target, legacy } = prepared;
      try {
        if (legacy) {
          // 旧管理器可能还在结束上一笔事务，重试仅发送正常停止信号；绝不强杀。
          const signalTimer = setInterval(() => { if (ownedProcess(owner)) process.kill(owner.pid, 'SIGTERM'); }, 500);
          try { await waitManagerRelease(paths, owner); } finally { clearInterval(signalTimer); }
        } else await waitManagerRelease(paths, owner);
        await startCommittedManager(paths, target);
      } catch (error) {
        diagnostic = safeStartupDiagnostic(error, 'handoff'); phase = 'recovery-required';
        // 未确认旧管理器退出时不改指针、不启动第二个写入者。
        const lock = await readState(paths.lock);
        if (!lock) {
          const state = await readState(paths.state);
          if (state?.current?.version === target.version && state.previous && state.workspaceId) {
            try {
              await verifySignedWebDirectory(versionPath(paths, state.previous), { releaseVersion: state.previous.version });
              await writeState(paths.state, { ...state, phase: 'rolled-back', current: state.previous, previous: target, diagnostic });
              await startCommittedManager(paths, state.previous); phase = 'rolled-back';
            } catch (failure) { await writeState(paths.state, { ...state, phase: 'recovery-required', diagnostic, rollbackDiagnostic: safeStartupDiagnostic(failure, 'rolling-back') }); }
          }
        }
      } finally { await monitor?.close({ handoff: true }); process.exit(diagnostic ? 1 : 0); }
    }
  });
  process.on('disconnect', () => { if (!committed) process.exit(1); });
}
