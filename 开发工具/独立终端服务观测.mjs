import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { 根目录 } from './公共.mjs';

// 仅在Terminal前台托管原CLI并记录生命周期；不实现后台/重连，不改变正式包。
assert.equal(process.stdin.isTTY, true);
assert.equal(process.argv.length, 3);
const output = resolve(process.argv[2]);
assert.ok(output.startsWith(resolve(根目录, '.运行/output/SQLite退出恢复-')));
assert.ok(lstatSync(output).isDirectory() && !lstatSync(output).isSymbolicLink());
assert.equal(JSON.parse(readFileSync(join(output, '恢复验收.json'))).passed, true);
const log = join(output, '独立终端生命周期.jsonl');
if (existsSync(log)) { const stat = lstatSync(log); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0); }
const emit = event => appendFileSync(log, JSON.stringify({ date: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 });
emit({ phase: 'host-start', pid: process.pid, ppid: process.ppid, tty: true });
const child = spawn(process.execPath, ['开发工具/日常工作台命令.mjs', '--启动', '--运行包=.运行/SQLite日常准备-UWriM2/准备清单.json', '--清单指纹=a44877449e31671952933ddd7a1b5e1f3acaa12aa7479a6395d4aa94d104b1ed', '--已保存并关闭'], { cwd: 根目录, stdio: ['inherit', 'pipe', 'pipe'] });
emit({ phase: 'service-spawn', pid: child.pid });
let lines = '';
child.stdout.on('data', bytes => {
  process.stdout.write(bytes); lines += bytes.toString('utf8');
  while (lines.includes('\n')) {
    const index = lines.indexOf('\n'), line = lines.slice(0, index); lines = lines.slice(index + 1);
    try { const value = JSON.parse(line); if (typeof value.phase === 'string') emit({ phase: 'cli-state', state: value.phase, boundary: value.boundary }); } catch { /* 不把原始输出、内部材料或未知错误原文写入日志。 */ }
  }
  if (lines.length > 8192) lines = '';
});
child.stderr.on('data', bytes => { process.stderr.write(bytes); emit({ phase: 'service-stderr', bytes: bytes.length }); });
process.stdout.on('error', error => emit({ phase: 'terminal-output-error', stream: 'stdout', code: error.code }));
process.stderr.on('error', error => emit({ phase: 'terminal-output-error', stream: 'stderr', code: error.code }));
let sampling = false;
const timer = setInterval(async () => {
  if (sampling) return; sampling = true;
  try {
    // HTML只允许顶层导航，普通fetch应403；只探测受ready门控的静态资源，不签发页面票据。
    const response = await fetch('http://localhost:3100/logo.svg', { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(3000) });
    await response.body?.cancel(); emit({ phase: 'heartbeat', pid: child.pid, http: response.status });
  } catch { emit({ phase: 'heartbeat-failed', pid: child.pid }); }
  finally { sampling = false; }
}, 15000);
for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(name, () => emit({ phase: 'host-signal', signal: name }));
child.on('error', error => emit({ phase: 'spawn-error', code: error.code ?? 'unknown' }));
child.on('exit', (code, signal) => { clearInterval(timer); emit({ phase: 'service-exit', pid: child.pid, code, signal }); process.exitCode = code ?? 1; });
process.on('exit', code => emit({ phase: 'host-exit', code }));
console.log('阶段6前台服务：请保留此终端。查看状态输入“状态”；保存关闭后输入“已保存并关闭，停止”。');
