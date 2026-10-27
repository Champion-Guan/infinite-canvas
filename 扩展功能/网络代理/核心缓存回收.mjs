import { execFileSync } from 'node:child_process';
import { readdir, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';

// 只能回收本模块的完整核心缓存；其他工作台仍运行的二进制必须保留。
export async function 回收退出核心(versions, currentHash, retained = []) {
  let commands;
  try { commands = execFileSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 ** 2 }).split('\n').map(line => line.trim()); }
  catch { return; }
  const candidates = [];
  for (const name of await readdir(versions)) {
    if (!/^[a-f0-9]{64}$/.test(name) || name === currentHash || retained.includes(name)) continue;
    const folder = join(versions, name), binary = join(folder, 'mihomo'), info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077 || (await readdir(folder)).join(',') !== 'mihomo') continue;
    if (commands.some(command => command === binary || command.startsWith(binary + ' '))) continue;
    candidates.push({ folder, modified: info.mtimeMs });
  }
  candidates.sort((a, b) => b.modified - a.modified);
  for (const item of candidates.slice(1)) await rm(item.folder, { recursive: true });
}
