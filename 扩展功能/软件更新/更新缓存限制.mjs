import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { 检查目录容量 } from '../本机服务/目录容量限制.mjs';
import { compareVersions } from './stable-version.mjs';
import { UpdateError } from './update-auth.mjs';

// 签名协议允许的单包最大256MiB，加上清单和签名；实际只保留一个包。
export const 更新下载缓存上限 = 256 * 1024 ** 2 + 65536 + 64;
export function 检查更新缓存(directory, incomingBytes) {
  try { return 检查目录容量(directory, { maxBytes: 更新下载缓存上限, incomingBytes, reserveBytes: 1024 ** 3 }); }
  catch { throw new UpdateError('download_cache_limit'); }
}

// 重启后再次验签并核对完整包摘要，复用磁盘中的同一安装包，防止每次启动重复下载。
export async function 查找已验证更新缓存(directory, selected, bytes, signature, names) {
  const folders = await readdir(directory);
  for (const name of folders) {
    if (!/^verified-[a-f0-9-]{36}$/.test(name)) continue;
    const path = join(directory, name);
    try {
      const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) continue;
      const files = [...names, 'package.zip'];
      for (const file of files) {
        const item = await lstat(join(path, file));
        if (!item.isFile() || item.isSymbolicLink() || item.nlink !== 1 || item.uid !== process.getuid() || item.mode & 0o022) throw Error('unsafe-cache');
        if (item.size !== (file === 'package.zip' ? selected.size : file === names[0] ? bytes.length : signature.length)) throw Error('different-cache');
      }
      if (!(await readFile(join(path, names[0]))).equals(bytes) || !(await readFile(join(path, names[1]))).equals(signature)) continue;
      const hash = createHash('sha256');
      for await (const block of createReadStream(join(path, 'package.zip'), { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) hash.update(block);
      if (hash.digest('hex') === selected.sha256) return path;
    } catch { /* 不完整或损坏的缓存不冒充已验证包。 */ }
  }
  return null;
}

// 仅清理本程序生成的 verified-UUID 目录。安装成功后 currentVersion 会淘汰该包；
// 尚未安装时只留最新一个完整下载；真正复用前仍由下载器重新验签、核对摘要。
export async function 清理更新缓存(directory, { keep, currentVersion, manifestNames = ['guan-stable-manifest.json', 'guan-stable-manifest.sig'], installedOnly = false } = {}) {
  let root;
  try { root = await lstat(directory); } catch (error) { if (error.code === 'ENOENT') return { removed: 0 }; throw error; }
  if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid() || root.mode & 0o077) throw new UpdateError('download_cache_unsafe');
  const folders = [];
  for (const name of await readdir(directory)) {
    if (!/^verified-[a-f0-9-]{36}$/.test(name)) continue;
    const folder = join(directory, name), info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077) throw new UpdateError('download_cache_unsafe');
    folders.push({ name, folder, modified: info.mtimeMs });
  }
  if (installedOnly) {
    let removed = 0;
    for (const item of folders) {
      try {
        const file = join(item.folder, manifestNames[0]), info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) continue;
        const manifest = JSON.parse(await readFile(file, 'utf8'));
        if (compareVersions(manifest.version, currentVersion) > 0) continue;
      } catch { continue; }
      await rm(item.folder, { recursive: true, force: true }); removed++;
    }
    return { removed };
  }
  let retained = keep;
  if (keep === undefined) {
    for (const item of folders.sort((a, b) => b.modified - a.modified)) {
      try {
        const manifestFile = join(item.folder, manifestNames[0]);
        const info = await lstat(manifestFile), zip = await lstat(join(item.folder, 'package.zip'));
        if (!info.isFile() || info.isSymbolicLink() || info.size > 65536 || !zip.isFile() || zip.isSymbolicLink() || zip.size > 更新下载缓存上限) continue;
        const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
        if (currentVersion && compareVersions(manifest.version, currentVersion) <= 0) continue;
        retained = item.name; break;
      } catch { /* 未完成、无效或已安装版本不保留。 */ }
    }
  }
  let removed = 0;
  for (const item of folders) if (item.name !== retained) { await rm(item.folder, { recursive: true, force: true }); removed++; }
  return { removed, retained: retained || null };
}
