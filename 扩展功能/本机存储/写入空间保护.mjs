import { lstatSync, statfsSync } from 'node:fs';
import { requireValue } from './协议.mjs';

export const 数据磁盘保留字节 = 1024 ** 3;
export const WAL检查阈值 = 16 * 1024 ** 2;
export function 配置SQLite日志(db) {
  db.exec('PRAGMA wal_autocheckpoint=256; PRAGMA journal_size_limit=16777216;');
}
// 正常写入自动回收WAL；长读事务阻止回收时暂停新写入，不任由日志扩张。
export function 检查SQLite写入空间(db, dbPath, root, bytes = 0, availableBytes) {
  const fs = availableBytes ? null : statfsSync(root), free = availableBytes ? availableBytes() : fs.bavail * fs.bsize;
  requireValue(Number.isFinite(free) && free >= 数据磁盘保留字节 + bytes * 2,
    'insufficient_space', '磁盘剩余空间不足1GiB，已暂停新增写入；原有数据保留。', 507);
  let size = 0;
  try { size = lstatSync(dbPath + '-wal').size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (size < WAL检查阈值) return;
  const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  requireValue(result.busy === 0, 'workspace_busy', '存储日志等待读取任务释放，已暂停新增写入，请稍后重试。', 503);
}
