import { lstat, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { 检查目录容量 } from '../本机服务/目录容量限制.mjs';
import { requireValue } from '../本机存储/协议.mjs';

const ownerName = '代理所有者.json';
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
export async function 记录代理目录所有者(directory, watchdogPid = null) {
  await writeFile(join(directory, ownerName), JSON.stringify({ ownerPid: process.pid, watchdogPid }), { mode: 0o600 });
}
export async function 清理中断代理目录(parent) {
  const info = await lstat(parent);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && !(info.mode & 0o077), 'proxy_runtime_invalid', '代理运行目录身份异常。');
  let removed = 0;
  for (const name of await readdir(parent)) {
    if (!/^workbench-proxy-[A-Za-z0-9]{6}$/.test(name)) continue;
    const directory = join(parent, name), stat = await lstat(directory);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid(), 'proxy_runtime_invalid', '代理暂存目录身份异常。');
    let owner;
    try {
      const file = join(directory, ownerName), s = await lstat(file);
      if (!s.isFile() || s.isSymbolicLink() || s.size > 1024 || s.uid !== process.getuid()) continue;
      owner = JSON.parse(await readFile(file, 'utf8'));
      if (!Number.isSafeInteger(owner.ownerPid) || owner.ownerPid < 1 || owner.watchdogPid !== null && (!Number.isSafeInteger(owner.watchdogPid) || owner.watchdogPid < 1)) continue;
    } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; throw error; }
    if (alive(owner.ownerPid) || alive(owner.watchdogPid)) continue;
    await rm(directory, { recursive: true, force: true }); removed++;
  }
  检查目录容量(parent, { maxBytes: 512 * 1024 ** 2, incomingBytes: 256 * 1024 ** 2, reserveBytes: 1024 ** 3 });
  return { removed };
}
