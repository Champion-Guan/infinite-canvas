import { lstat, readdir, readFile, rename, rm, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PROTOCOL, SCHEMA_VERSION, validUUID, validHash } from '../本机存储/协议.mjs';

const receiptName = '.历史备份清理-v1.json';
const pendingPrefix = '.清理中-';
async function present(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function owned(info, directory) {
  return info && !info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile() && info.nlink === 1) &&
    info.uid === process.getuid() && !(info.mode & 0o022);
}
async function safeTree(folder, { interrupted = false, workspaceId } = {}) {
  if (!owned(await present(folder), true)) return false;
  const names = await readdir(folder);
  if (names.some(name => !['工作台.sqlite', '清单.json', '媒体'].includes(name))) return false;
  for (const name of names) {
    const file = join(folder, name);
    if (!owned(await present(file), name === '媒体')) return false;
    if (name === '媒体') for (const media of await readdir(file)) {
      if (!validHash(media) || !owned(await present(join(file, media)), false)) return false;
    }
  }
  // 此前已验证并改名的半份清理目录允许下次继续，不跟随链接或扩大文件范围。
  if (interrupted) return true;
  const info = await present(join(folder, '清单.json'));
  if (!info || info.size > 4 * 1024 ** 2) return false;
  const manifest = JSON.parse(await readFile(join(folder, '清单.json'), 'utf8'));
  if (manifest.protocol !== PROTOCOL || manifest.schemaVersion !== SCHEMA_VERSION || manifest.workspaceId !== workspaceId || !Array.isArray(manifest.files)) return false;
  const expected = new Set(['工作台.sqlite', '清单.json', '媒体']);
  const media = new Set();
  let database = false;
  for (const item of manifest.files) {
    if (!item || !validHash(item.hash) || !Number.isSafeInteger(item.size) || item.size < 0) return false;
    if (item.path === '工作台.sqlite' && !database) database = true;
    else if (/^媒体\/[a-f0-9]{64}$/.test(item.path) && !media.has(item.path.slice(3))) media.add(item.path.slice(3));
    else return false;
    const file = await present(join(folder, item.path));
    if (!owned(file, false) || file.size !== item.size) return false;
  }
  return database && names.length === expected.size && names.every(name => expected.has(name)) &&
    manifest.mediaCount === media.size && (await readdir(join(folder, '媒体'))).every(name => media.has(name));
}

// 只在已独占打开原工作区、且页面尚未接入时运行一次。后续用户手动备份保留。
// 只处理同工作区生成的备份；当前数据库、媒体、配置和未知目录不在删除范围。
export async function 清理升级历史备份({ dataRoot, workspaceId, remove = rm } = {}) {
  if (!validUUID(workspaceId) || !owned(await present(dataRoot), true)) throw Error('legacy_cleanup_unsafe');
  const receipt = join(dataRoot, receiptName), previous = await present(receipt);
  if (previous) {
    if (!owned(previous, false) || previous.size > 4096) throw Error('legacy_cleanup_unsafe');
    const value = JSON.parse(await readFile(receipt, 'utf8'));
    if (value.workspaceId !== workspaceId || value.completed !== true) throw Error('legacy_cleanup_unsafe');
    return { alreadyCompleted: true, removed: 0, skipped: value.skipped };
  }
  const parent = join(dataRoot, '备份'), root = await present(parent);
  if (root && !owned(root, true)) throw Error('legacy_cleanup_unsafe');
  let removed = 0, skipped = 0;
  for (const name of root ? await readdir(parent) : []) {
    const interrupted = name.startsWith(pendingPrefix), id = interrupted ? name.slice(pendingPrefix.length) : name;
    if (!validUUID(id)) { skipped++; continue; }
    const folder = join(parent, name);
    let valid = false;
    try { valid = await safeTree(folder, { interrupted, workspaceId }); } catch { /* 未知或损坏备份保留。 */ }
    if (!valid) { skipped++; continue; }
    const pending = join(parent, pendingPrefix + id);
    if (!interrupted) {
      if (await present(pending)) { skipped++; continue; }
      await rename(folder, pending);
    }
    await remove(pending, { recursive: true, force: true }); removed++;
  }
  const temporary = receipt + '.临时-' + process.pid;
  let handle;
  try {
    // 回执不足1KiB，不复制业务数据；磁盘极低时也可先完成释放。
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ format: 1, workspaceId, completed: true, removed, skipped }) + '\n');
    await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, receipt);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return { removed, skipped, alreadyCompleted: false };
}
