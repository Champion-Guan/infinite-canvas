import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readState, versionPath } from './Web安装目录.mjs';
import { ownedProcess } from './管理进程身份.mjs';
import { readWebAddress } from './Web运行地址.mjs';
import { serveWebUpdateProgress } from './Web更新进度服务.mjs';

// 观察进程不安装、不写事务、不持有页面授权。管理器换代后仍使用同一进度地址。
export async function readDetachedProgress(paths, target, live) {
  const state = await readState(paths.state), owner = await readState(paths.lock);
  const origin = await readWebAddress(paths, owner, state, ownedProcess);
  const expectedCommand = state?.current && versionPath(paths, state.current) + '/扩展功能/客户安装/Web客户命令.mjs supervisor';
  const matchingManager = Boolean(owner?.command?.endsWith(expectedCommand));
  const healthy = origin && matchingManager;
  if (state?.current?.version === target && state.phase === 'committed') return {
    target, currentVersion: target, state: healthy ? 'success' : 'restarting-manager', origin: healthy ? origin : null,
    reason: null, diagnostic: state.diagnostic || null,
  };
  if (state?.phase === 'rolled-back' && state.previous?.version === target) return {
    target, currentVersion: state.current.version, state: healthy ? 'rolled-back' : 'recovery-required',
    origin: healthy ? origin : null, reason: 'update_failed_rolled_back', diagnostic: state.diagnostic || null,
  };
  if (state?.phase === 'recovery-required') return { target, state: 'recovery-required', reason: 'update_rollback_failed', diagnostic: state.diagnostic || null, rollbackDiagnostic: state.rollbackDiagnostic || null, origin: null };
  if (live && Date.now() - live.at < 5000) return live.value;
  return { target, state: state?.target?.version === target ? state.phase : 'unavailable', origin: null, reason: null };
}

export function createDetachedProgressObserver(readStatus, paths, { onSpawn = () => {} } = {}) {
  let current = null, pending = null;
  return {
    async open(target) {
      if (pending) { await pending; return this.open(target); }
      if (current?.target === target && current.proc.connected) return { url: current.url };
      await this.close();
      pending = new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [fileURLToPath(import.meta.url)], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
        onSpawn(proc);
        const timeout = setTimeout(() => { proc.kill('SIGTERM'); reject(Error('update_progress_unavailable')); }, 10000);
        proc.once('error', error => { clearTimeout(timeout); reject(error); });
        proc.once('exit', () => { clearTimeout(timeout); if (!current) reject(Error('update_progress_unavailable')); });
        proc.on('message', message => {
          if (message?.type !== 'web-progress-ready') return;
          clearTimeout(timeout);
          const timer = setInterval(() => { if (proc.connected) proc.send({ type: 'web-progress-state', value: readStatus(target) }); }, 500);
          timer.unref(); proc.unref(); proc.channel?.unref();
          current = { target, url: message.url, proc, timer }; resolve({ url: message.url });
        });
        proc.send({ type: 'web-progress-start', paths, target, value: readStatus(target) });
      });
      try { return await pending; } finally { pending = null; }
    },
    async close({ handoff = false } = {}) {
      if (pending) await pending.catch(() => {});
      if (current) { clearInterval(current.timer); if (current.proc.connected) { if (handoff) current.proc.disconnect(); else current.proc.send({ type: 'web-progress-close' }); } current = null; }
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.connected) {
  let monitor, live;
  const bootstrap = setTimeout(() => process.exit(1), 10000);
  process.on('message', async message => {
    if (message?.type === 'web-progress-start' && !monitor) {
      clearTimeout(bootstrap); live = { value: message.value, at: Date.now() };
      try {
        monitor = await serveWebUpdateProgress({ target: message.target, readStatus: () => readDetachedProgress(message.paths, message.target, live) });
        process.send({ type: 'web-progress-ready', url: monitor.url });
        setTimeout(() => { monitor.close(); process.exit(0); }, 60 * 60 * 1000);
      } catch { process.exit(1); }
    } else if (message?.type === 'web-progress-state') live = { value: message.value, at: Date.now() };
    else if (message?.type === 'web-progress-close') { monitor?.close(); process.exit(0); }
  });
  // 父管理器退出是接续的一部分。HTTP观察服务继续存活，不把断线伪装为成功。
  process.on('disconnect', () => {});
}
