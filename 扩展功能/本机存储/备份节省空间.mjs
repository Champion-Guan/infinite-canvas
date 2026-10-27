import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, copyFileSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { StorageError, requireValue } from './协议.mjs';

// APFS 使用写入时复制；其他文件系统由 Node 回退普通复制。文件独立，绝不使用硬链接。
export function 复制独立备份文件(source, target, expectedHash, expectedSize) {
  const original = lstatSync(source);
  requireValue(original.isFile() && !original.isSymbolicLink() && original.nlink === 1 && original.size === expectedSize,
    'unsafe_path', '备份来源必须是独立的普通文件。');
  copyFileSync(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
  const copied = lstatSync(target);
  try {
    chmodSync(target, 0o600);
    requireValue((copied.dev !== original.dev || copied.ino !== original.ino) && copied.nlink === 1 && copied.size === expectedSize &&
      createHash('sha256').update(readFileSync(target)).digest('hex') === expectedHash,
    'backup_corrupt', '备份副本校验失败，原始数据未修改。');
    const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch (error) {
    if (lstatSync(target).ino === copied.ino) unlinkSync(target);
    throw error;
  }
}

export function 复用相同数据库快照(previous, target, hash, size) {
  if (!previous || previous.hash !== hash || previous.size !== size) return false;
  const temporary = target + '.省空间-' + randomUUID();
  let reused = false;
  try {
    复制独立备份文件(previous.path, temporary, hash, size);
    renameSync(temporary, target);
    reused = true;
  } catch (error) {
    // 旧备份被移走或损坏时，保留刚由 SQLite 生成的完整新快照。
    if (!(error instanceof StorageError || ['ENOENT', 'EACCES', 'EPERM'].includes(error.code))) {
      try { unlinkSync(temporary); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
      throw error;
    }
  }
  try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return reused;
}
