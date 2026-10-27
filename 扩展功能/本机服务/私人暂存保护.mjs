import { lstatSync, readdirSync, statfsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const MiB = 1024 ** 2;
export function 准备私人暂存(directory, incomingBytes) {
  const root = lstatSync(directory);
  if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid() || root.mode & 0o077) throw Error('私人暂存目录异常');
  let count = 0, bytes = 0;
  for (const name of readdirSync(directory)) {
    // 同时识别旧安装器留下的状态原子写；无进程标记的旧格式只回收超过24小时的文件。
    const match = /^\.private-write-(?:(\d+)-)?[a-f0-9-]{36}$/.exec(name)
      || /^(?:当前版本|运行地址|待安装版本)\.json\.[a-f0-9-]{36}$/.exec(name);
    if (!match) continue;
    const file = join(directory, name), info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid()) throw Error('私人暂存文件异常');
    let inactive = !match[1] && Date.now() - info.mtimeMs > 24 * 60 * 60 * 1000;
    if (match[1]) {
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || pid < 1) throw Error('私人暂存身份异常');
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') inactive = true; else throw error; }
    }
    if (inactive) { unlinkSync(file); continue; }
    count++; bytes += info.size;
  }
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes < 0 || incomingBytes > 32 * MiB || count >= 16 || bytes + incomingBytes > 128 * MiB)
    throw Object.assign(Error('私人配置暂存超过上限，原文件保留'), { code: 'private_staging_limit' });
  const fs = statfsSync(directory);
  if (fs.bavail * fs.bsize < 1024 ** 3 + incomingBytes) throw Object.assign(Error('磁盘余量不足，原配置保留'), { code: 'disk_space_insufficient' });
}
