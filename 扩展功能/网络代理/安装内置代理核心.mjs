import { gunzipSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { lstat, readFile, readdir, rm, open, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { privateDirectory } from '../软件更新/runtime-paths.mjs';
import { 检查目录容量 } from '../本机服务/目录容量限制.mjs';
import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { 回收退出核心 } from './核心缓存回收.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const allowed = /^[a-f0-9]{64}$/;
async function readChecked(path, limit) {
  const s = await lstat(path);
  requireValue(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.uid === process.getuid() && !(s.mode & 0o022) && s.size <= limit,
    'proxy_core_invalid', '内置代理核心文件不符合校验要求。', 503);
  return readFile(path);
}
export async function installBundledProxyCore(directory, cacheRoot, { retainHashes = [] } = {}) {
  const manifest = JSON.parse(await readChecked(join(directory, '核心清单.json'), 8192));
  requireValue(allowed.test(manifest.sha256) && allowed.test(manifest.archiveSha256) && manifest.platform === process.platform && manifest.arch === process.arch &&
    Number.isSafeInteger(manifest.size) && manifest.size >= 8 && manifest.size <= 128 * 1024 ** 2 && Number.isSafeInteger(manifest.archiveSize) && manifest.archiveSize > 0 && manifest.archiveSize <= 32 * 1024 ** 2,
  'proxy_core_invalid', '内置代理核心清单不匹配。', 503);
  await privateDirectory(cacheRoot);
  const versions = join(cacheRoot, '版本'); await privateDirectory(versions);
  // 只回收本模块、已退出进程留下的半份核心；原配置和运行目录均不参与。
  for (const name of await readdir(versions)) {
    if (!allowed.test(name)) continue;
    const folder = join(versions, name), stat = await lstat(folder);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && !(stat.mode & 0o077), 'proxy_core_invalid', '代理核心缓存目录异常。', 503);
    for (const file of await readdir(folder)) {
      const match = /^\.核心解压-(\d+)-[a-f0-9-]{36}$/.exec(file);
      if (!match) continue;
      const path = join(folder, file), item = await lstat(path);
      requireValue(item.isFile() && !item.isSymbolicLink() && item.uid === process.getuid(), 'proxy_core_invalid', '代理核心暂存异常。', 503);
      try { process.kill(Number(match[1]), 0); }
      catch (error) { if (error.code === 'ESRCH') { await rm(path); continue; } throw error; }
      throw new StorageError('proxy_core_busy', '另一进程正在安装代理核心，请稍后重试。', 409);
    }
  }
  const target = join(versions, manifest.sha256); await privateDirectory(target);
  const path = join(target, 'mihomo');
  requireValue(manifest.variant !== 'Mihomo Smart' || manifest.model, 'proxy_core_invalid', 'Smart核心缺少内置模型。', 503);
  let modelPath;
  if (manifest.model) {
    requireValue(manifest.model.file === '智能选路模型.bin' && allowed.test(manifest.model.sha256) && Number.isSafeInteger(manifest.model.size) && manifest.model.size > 0 && manifest.model.size <= 32 * 1024 ** 2,
      'proxy_core_invalid', 'Smart模型清单无效。', 503);
    const model = await readChecked(join(directory, manifest.model.file), 32 * 1024 ** 2);
    requireValue(model.length === manifest.model.size && digest(model) === manifest.model.sha256, 'proxy_core_invalid', 'Smart模型校验失败。', 503);
    modelPath = join(directory, manifest.model.file);
  }
  let existing;
  try { existing = await readChecked(path, 128 * 1024 ** 2); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) requireValue(existing.length === manifest.size && digest(existing) === manifest.sha256 && (await lstat(path)).mode & 0o100, 'proxy_core_invalid', '已安装代理核心校验失败。', 503);
  else {
    检查目录容量(cacheRoot, { maxBytes: 512 * 1024 ** 2, incomingBytes: manifest.size, reserveBytes: 1024 ** 3 });
    const archive = await readChecked(join(directory, '代理核心.gz'), 32 * 1024 ** 2);
    requireValue(archive.length === manifest.archiveSize && digest(archive) === manifest.archiveSha256, 'proxy_core_invalid', '内置代理核心压缩包校验失败。', 503);
    let binary;
    try { binary = gunzipSync(archive, { maxOutputLength: manifest.size }); }
    catch { throw new StorageError('proxy_core_invalid', '内置代理核心解压失败或超限。', 503); }
    requireValue(binary.length === manifest.size && digest(binary) === manifest.sha256 && binary.readUInt32LE(0) === 0xfeedfacf && binary.readUInt32LE(4) === 0x0100000c,
      'proxy_core_invalid', '内置代理核心架构或指纹错误。', 503);
    const temporary = join(target, '.核心解压-' + process.pid + '-' + randomUUID());
    try {
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o700);
      try { await file.writeFile(binary); await file.sync(); } finally { await file.close(); }
      await rename(temporary, path);
      const folder = await open(target, constants.O_RDONLY);
      try { await folder.sync(); } finally { await folder.close(); }
    } finally { await rm(temporary, { force: true }); }
  }
  // 仅清理本模块的旧核心缓存，保留当前和最近上一份；不触碰配置和其他进程目录。
  await 回收退出核心(versions, manifest.sha256, retainHashes);
  return { path, sha256: manifest.sha256, version: manifest.version, archiveSha256: manifest.archiveSha256, ...(modelPath ? { model: { path: modelPath, sha256: manifest.model.sha256, size: manifest.model.size } } : {}) };
}
