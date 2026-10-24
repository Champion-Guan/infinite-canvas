import { lstat, readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { WEB_APP, WEB_REPOSITORY, WEB_ORIGIN, WEB_MANIFEST_NAMES, verifyWebManifest, sha256, exact, fail } from './Web发布协议.mjs';
import { readWebArchive } from './Web压缩包读取.mjs';

export function safeMember(name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || /[\\:\x00-\x1f\x7f]/.test(name) ||
    name.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.env') || ['.运行', '.git', '工作区', 'data', 'user-data', 'backups'].includes(p)) ||
    /\.(?:sqlite|db|key|pem|xlsx|xls)$/i.test(name)) fail('web_package_invalid');
  return name;
}
export async function inventoryWebFiles(root) {
  const files = {};
  async function walk(directory) {
    for (const entry of (await readdir(directory)).sort()) {
      const path = join(directory, entry), name = relative(root, path).split('\\').join('/');
      safeMember(name);
      const s = await lstat(path);
      if (s.isSymbolicLink() || s.uid !== process.getuid() || s.mode & 0o022) fail('web_package_invalid');
      if (s.isDirectory()) { await walk(path); continue; }
      if (!s.isFile() || s.nlink !== 1 || s.size > (name === 'runtime/node' ? 160 : 32) * 1024 * 1024) fail('web_package_invalid');
      if (!['工作台发布.json', ...WEB_MANIFEST_NAMES].includes(name)) files[name] = sha256(await readFile(path));
      if (Object.keys(files).length > 20000) fail('web_package_invalid');
    }
  }
  const s = await lstat(root);
  if (!s.isDirectory() || s.isSymbolicLink()) fail('web_package_invalid');
  await walk(root); return files;
}
export async function verifyWebDirectory(root, { manifest, selected }) {
  const bytes = await readFile(join(root, '工作台发布.json'));
  if (bytes.length > 4 * 1024 * 1024 || sha256(bytes) !== manifest.inventorySHA256) fail('web_package_invalid');
  const m = JSON.parse(bytes);
  if (!exact(m, ['format', 'app', 'repository', 'version', 'commit', 'dataSchema', 'origin', 'helper', 'files']) ||
    m.format !== 1 || m.app !== WEB_APP || m.repository !== WEB_REPOSITORY || m.version !== manifest.version || m.commit !== manifest.commit ||
    m.dataSchema !== 1 || m.origin !== WEB_ORIGIN || !exact(m.helper, ['sha256', 'sourceSHA256']) ||
    !/^[a-f0-9]{64}$/.test(m.helper.sha256) || !/^[a-f0-9]{64}$/.test(m.helper.sourceSHA256) ||
    !m.files || typeof m.files !== 'object' || Array.isArray(m.files)) fail('web_package_invalid');
  const actual = await inventoryWebFiles(root), expected = Object.entries(m.files);
  if (!expected.length || expected.length !== Object.keys(actual).length || expected.some(([name, hash]) => safeMember(name) && actual[name] !== hash)) fail('web_package_invalid');
  for (const file of ['web/index.html', '扩展功能/客户安装/Web客户命令.mjs', '扩展功能/客户安装/Web客户服务.mjs', '启动工作台.command', '安装工作台.command', 'runtime/node', '系统助手/系统钥匙串']) {
    if (!Object.hasOwn(actual, file)) fail('web_package_invalid');
  }
  if (actual['runtime/node'] !== selected.runtimeSha256 || actual['系统助手/系统钥匙串'] !== m.helper.sha256 ||
    (await lstat(join(root, 'runtime/node'))).size !== selected.runtimeSize) fail('web_package_invalid');
  for (const file of ['runtime/node', '系统助手/系统钥匙串']) {
    const data = await readFile(join(root, file)), stat = await lstat(join(root, file));
    if (!(stat.mode & 0o100) || data.readUInt32LE(0) !== 0xfeedfacf || data.readUInt32LE(4) !== 0x0100000c) fail('architecture_unsupported');
  }
  return m;
}
export async function verifySignedWebDirectory(root, options = {}) {
  const identity = verifyWebManifest(await readFile(join(root, WEB_MANIFEST_NAMES[0])), await readFile(join(root, WEB_MANIFEST_NAMES[1])), options);
  return { ...identity, inventory: await verifyWebDirectory(root, identity) };
}
export async function extractSignedWebPackage(download, destination, options = {}) {
  const identity = verifyWebManifest(await readFile(join(download, WEB_MANIFEST_NAMES[0])), await readFile(join(download, WEB_MANIFEST_NAMES[1])), options);
  const archive = await readFile(join(download, 'package.zip'));
  if (archive.length !== identity.selected.size || sha256(archive) !== identity.selected.sha256) fail('package_integrity_failed');
  const decoded = readWebArchive(archive, { trustedRuntime: identity.selected });
  // mkdir非递归：已有版本和失败残留均保留，不能覆盖。
  await mkdir(destination, { mode: 0o700 });
  for (const [name, entry] of decoded.files) {
    const member = safeMember(name.slice(decoded.root.length + 1)), target = resolve(destination, member);
    if (!target.startsWith(resolve(destination) + '/')) fail('web_package_invalid');
    await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
    await writeFile(target, entry.bytes, { flag: 'wx', mode: entry.executable ? 0o700 : 0o600 });
  }
  for (const name of WEB_MANIFEST_NAMES) await writeFile(join(destination, name), await readFile(join(download, name)), { flag: 'wx', mode: 0o600 });
  return { ...identity, inventory: await verifyWebDirectory(destination, identity) };
}
