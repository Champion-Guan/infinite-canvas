import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { 开始目录写入监测 } from '../扩展功能/本机服务/目录写入监测.mjs';

const entry = fileURLToPath(import.meta.url);
// 守护进程独立于构建主进程，即使主进程被SIGKILL，也会结束自己的构建进程组。
export function 执行有界构建命令(command, args, { cwd, env = process.env, timeout = 300_000, budgetDirectory, maxBytes = 4 * 1024 ** 3, reserveBytes = 3 * 1024 ** 3, intervalMs = 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const guard = spawn(process.execPath, [entry, '--守护'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let failure = null, output = Buffer.alloc(0);
    const record = chunk => { output = Buffer.concat([output, chunk]); if (output.length > 1024 ** 2) output = output.subarray(-(1024 ** 2)); };
    guard.stdout.on('data', record); guard.stderr.on('data', record);
    guard.on('message', value => { if (value?.type === 'build-failed') failure = value.code; });
    guard.once('error', reject);
    guard.once('close', (status, signal) => {
      if (status === 0 && !failure) resolve(output);
      else reject(Object.assign(Error('构建子进程失败：' + (failure || signal || status) + (output.length ? '\n' + output.toString('utf8') : '')), { code: failure || 'build_command_failed', status }));
    });
    guard.send({ command, args, cwd, env, timeout, budgetDirectory, maxBytes, reserveBytes, intervalMs });
  });
}

async function runGuard(options) {
  let child, monitor, timeout, forceTimer, finishing = false, reason = null;
  const killGroup = signal => { if (child?.pid) try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  const stop = code => {
    reason ||= code;
    if (!child || finishing) return;
    killGroup('SIGTERM');
    forceTimer ||= setTimeout(() => killGroup('SIGKILL'), 1000);
  };
  const finish = code => {
    if (finishing) return; finishing = true;
    monitor?.stop(); clearTimeout(timeout); clearTimeout(forceTimer);
    // 主命令已退出，不能留下后台派生进程继续写盘。
    killGroup('SIGKILL');
    if (reason || code) process.send?.({ type: 'build-failed', code: reason || 'build_command_failed' });
    process.exitCode = reason || code ? 1 : 0;
    if (process.connected) process.disconnect();
  };
  process.once('disconnect', () => stop('build_owner_exited'));
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => stop('build_cancelled'));
  try {
    if (!process.connected || typeof options.command !== 'string' || !Array.isArray(options.args) || !Number.isInteger(options.timeout) || options.timeout < 1) throw Error('invalid_build_command');
    monitor = 开始目录写入监测(options.budgetDirectory, { maxBytes: options.maxBytes, reserveBytes: options.reserveBytes, allowSymlinks: true }, error => stop(error.code || 'disk_budget_exceeded'), options.intervalMs);
    child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', () => { reason ||= 'build_spawn_failed'; finish(1); });
    child.once('exit', code => { try { monitor?.check(); } catch (error) { reason ||= error.code; } finish(code ?? 1); });
    timeout = setTimeout(() => stop('build_command_timeout'), options.timeout);
  } catch (error) { reason = error.code || 'invalid_build_command'; finish(1); }
}
if (process.argv[1] === entry && process.argv[2] === '--守护') {
  if (!process.connected) throw Error('构建守护只能由构建器启动');
  process.once('message', options => { void runGuard(options); });
}
