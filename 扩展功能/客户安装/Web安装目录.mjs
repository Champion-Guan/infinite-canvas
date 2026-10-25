import { homedir } from 'node:os';
import { join } from 'node:path';
import { lstat, mkdir, readFile, cp, readdir, rm } from 'node:fs/promises';
import { verifySignedWebDirectory } from './Web安装包核验.mjs';
import { WEB_APP, WEB_ORIGIN, fail } from './Web发布协议.mjs';
import { 检查目录容量, 读取目录字节 } from '../本机服务/目录容量限制.mjs';
import { writePrivateFile } from '../软件更新/runtime-paths.mjs';

export const webInstallPaths = () => {
  const root = join(homedir(), 'Library/Application Support/AI-Workbench-Web安装');
  return { root, versions: join(root, '版本'), state: join(root, '当前版本.json'), lock: join(root, '运行锁.json'), address: join(root, '运行地址.json'), log: join(root, '工作台.log') };
};
export async function privateDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || s.mode & 0o077) fail('web_install_root_invalid');
}
export async function writeState(file, value) {
  const serialized = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(serialized) > 16384) fail('update_state_invalid');
  await writePrivateFile(file, serialized);
}
export async function readState(file) {
  try {
    const s = await lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid() || s.mode & 0o077 || s.size > 16384) fail('update_state_invalid');
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export function versionIdentity(inventory) {
  return { name: inventory.version + '-' + inventory.commit, version: inventory.version, commit: inventory.commit,
    dataSchema: inventory.dataSchema, origin: inventory.origin };
}
export function versionPath(paths, identity) {
  if (!identity || identity.name !== identity.version + '-' + identity.commit || !/^[0-9A-Za-z.+-]+-[a-f0-9]{40}$/.test(identity.name) ||
    identity.origin !== WEB_ORIGIN || identity.dataSchema !== 1) fail('update_state_invalid');
  return join(paths.versions, identity.name);
}
export async function installWebDirectory(source, paths = webInstallPaths(), options = {}) {
  const verified = await verifySignedWebDirectory(source, options);
  await privateDirectory(paths.root); await privateDirectory(paths.versions);
  if (await readState(paths.lock)) fail('web_service_running');
  // 首次安装不替换旧指针；升级必须经过独立管理器和安全停服事务。
  if (await readState(paths.state)) fail('web_use_update_flow');
  const identity = versionIdentity(verified.inventory), destination = versionPath(paths, identity);
  检查目录容量(paths.versions, { maxBytes: 2 * 1024 ** 3, incomingBytes: 读取目录字节(source, { maxBytes: 512 * 1024 ** 2 }), reserveBytes: 1024 ** 3 });
  // 只删除本次独占创建且尚未提交指针的目录，不碰已有版本。
  await mkdir(destination, { mode: 0o700 });
  let committed = false;
  try {
  await cp(source, destination, { recursive: true, force: false, errorOnExist: true, dereference: false });
  await verifySignedWebDirectory(destination, options);
  await writeState(paths.state, { app: WEB_APP, phase: 'committed', current: identity, workspaceId: null });
  committed = true;
  return { identity, destination };
  } finally { if (!committed) await rm(destination, { recursive: true, force: true }); }
}
export async function copyStableHelper(packageRoot, inventory) {
  const parent = join(homedir(), 'Library/Application Support/AI-Workbench-Web系统助手');
  await privateDirectory(parent);
  const directory = join(parent, inventory.helper.sha256);
  try {
    await mkdir(directory, { mode: 0o700 });
    await cp(join(packageRoot, '系统助手/系统钥匙串'), join(directory, '系统钥匙串'), { force: false, errorOnExist: true });
  } catch (e) { if (e.code !== 'EEXIST') throw e; }
  await privateDirectory(directory);
  if ((await readdir(directory)).join(',') !== '系统钥匙串') fail('invalid_keychain_helper');
  // 原凭据provider再次核验二进制；安装不读取或创建任何Keychain条目。
  return { helperPath: join(directory, '系统钥匙串'), helperSHA256: inventory.helper.sha256 };
}
