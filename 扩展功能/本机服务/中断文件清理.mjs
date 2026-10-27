import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// 由已经独占对应目录的调用方使用；只处理程序约定的暂存名，不扫描或删除业务文件。
export function 清理独占暂存文件(directory, pattern) {
  const root = lstatSync(directory);
  if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid() || root.mode & 0o022) throw Error('暂存目录身份异常');
  let removed = 0;
  for (const name of readdirSync(directory)) {
    if (!pattern.test(name)) continue;
    const file = join(directory, name), info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid()) throw Error('暂存文件身份异常');
    unlinkSync(file); removed++;
  }
  return removed;
}
