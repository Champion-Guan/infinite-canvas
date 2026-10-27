import { lstatSync, readdirSync, statfsSync } from 'node:fs';
import { join } from 'node:path';

// 只检查指定的生成目录，绝不自动删除业务数据。遇到链接或过多文件立即停止扩张。
export function 读取目录字节(directory, { maxBytes = Number.MAX_SAFE_INTEGER, maxEntries = 200_000, allowSymlinks = false } = {}) {
  let bytes = 0, entries = 0;
  function visit(path) {
    let info;
    // npm/Vite会在检查期间正常移走暂存文件；下一次采样仍会核对新位置。
    try { info = lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink() && allowSymlinks) { if (++entries > maxEntries) throw Object.assign(Error('目录条目过多'), { code: 'disk_budget_exceeded' }); return; }
    if (info.isSymbolicLink()) throw Object.assign(Error('生成目录含链接，未继续写入'), { code: 'disk_budget_unsafe_path' });
    if (++entries > maxEntries) throw Object.assign(Error('生成目录文件数量超过上限，未继续写入'), { code: 'disk_budget_exceeded' });
    if (info.isFile()) bytes += info.size;
    else if (info.isDirectory()) {
      let names;
      try { names = readdirSync(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of names) visit(join(path, entry));
    }
    else throw Object.assign(Error('生成目录类型异常'), { code: 'disk_budget_unsafe_path' });
    if (bytes > maxBytes) throw Object.assign(Error('生成目录容量超过上限，请先清理旧构建或更新缓存'), { code: 'disk_budget_exceeded' });
  }
  try { lstatSync(directory); } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  visit(directory);
  return bytes;
}

export function 检查目录容量(directory, { maxBytes, incomingBytes = 0, reserveBytes = 1024 ** 3, availableBytes, allowSymlinks = false } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(incomingBytes) || incomingBytes < 0 || incomingBytes > maxBytes || !Number.isSafeInteger(reserveBytes) || reserveBytes < 0)
    throw Object.assign(Error('磁盘限制配置无效'), { code: 'disk_budget_invalid' });
  const used = 读取目录字节(directory, { maxBytes: maxBytes - incomingBytes, allowSymlinks });
  const fs = availableBytes === undefined ? statfsSync(directory) : null;
  const free = availableBytes ?? fs.bavail * fs.bsize;
  if (!Number.isFinite(free) || free < reserveBytes + incomingBytes) throw Object.assign(Error('磁盘余量不足，未开始新的下载或构建'), { code: 'disk_space_insufficient' });
  return { used, maxBytes, free, reserveBytes };
}
