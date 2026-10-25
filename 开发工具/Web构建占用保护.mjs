import { constants, closeSync, lstatSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 清理Web构建临时依赖, 清理Web失败构建 } from './清理Web构建缓存.mjs';
import { 检查目录容量 } from '../扩展功能/本机服务/目录容量限制.mjs';

// 同一输出目录只允许一个构建；异常退出的锁在确认进程不存在后回收。
export function 占用Web构建目录(parent) {
  const file = join(parent, '.构建锁.json');
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || info.nlink !== 1 || info.size > 1024) throw Error('构建锁文件异常');
    const owner = JSON.parse(readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw Error('构建锁身份异常');
    try { process.kill(owner.pid, 0); throw Error('已有客户包构建进行中，未启动重复构建'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    unlinkSync(file);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const fd = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); }
  catch (error) { unlinkSync(file); throw error; }
  finally { closeSync(fd); }
  try {
    // 拿到唯一构建锁后，才回收上次异常退出遗留的半成品与临时依赖。
    for (const name of readdirSync(parent)) {
      if (!/^构建-[A-Za-z0-9]{6}$/.test(name)) continue;
      const output = join(parent, name);
      let complete = false;
      try { lstatSync(join(output, '构建结果.json')); complete = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (complete) 清理Web构建临时依赖(output); else 清理Web失败构建(output);
    }
    检查目录容量(parent, { maxBytes: 4 * 1024 ** 3, incomingBytes: 1536 * 1024 ** 2, reserveBytes: 3 * 1024 ** 3 }); }
  catch (error) { unlinkSync(file); throw error; }
  return () => unlinkSync(file);
}
