import { join } from 'node:path';
import { lstat, readFile, copyFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { privateDirectory, readState, writeState, versionPath } from './Web安装目录.mjs';
import { verifySignedWebDirectory } from './Web安装包核验.mjs';
import { verifyWebManifest, sha256, WEB_MANIFEST_NAMES, fail } from './Web发布协议.mjs';
import { writePrivateFile } from '../软件更新/runtime-paths.mjs';

async function bytes(file, limit) {
  const s = await lstat(file);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid() || s.mode & 0o022 || s.size > limit) fail('invalid_keychain_helper');
  return readFile(file);
}
export async function verifyHelperEvidence(directory, sourceSHA256, binaryDirectory = directory, options = {}) {
  const [manifest, signature, inventoryBytes] = await Promise.all([
    bytes(join(directory, WEB_MANIFEST_NAMES[0]), 65536), bytes(join(directory, WEB_MANIFEST_NAMES[1]), 64),
    bytes(join(directory, '工作台发布.json'), 256 * 1024),
  ]);
  const proof = verifyWebManifest(manifest, signature, options);
  if (sha256(inventoryBytes) !== proof.manifest.inventorySHA256) fail('invalid_keychain_helper');
  const inventory = JSON.parse(inventoryBytes);
  if (inventory.version !== proof.manifest.version || inventory.helper?.sha256 !== inventory.files?.['系统助手/系统钥匙串']) fail('invalid_keychain_helper');
  if (inventory.helper.sourceSHA256 !== sourceSHA256) fail('keychain_helper_migration_required');
  const helper = join(binaryDirectory, '系统钥匙串');
  if (sha256(await bytes(helper, 16 * 1024 * 1024)) !== inventory.helper.sha256) fail('invalid_keychain_helper');
  return { helperPath: helper, helperSHA256: inventory.helper.sha256 };
}

// 同一份Swift源码的重复构建仍会产生不同的二进制身份。沿用已安装、原签名证明的助手，
// 避免升级时让钥匙串把正常读取当成另一个程序；源码变化必须另做明确迁移。
export async function continueSignedHelper(packageRoot, inventory, paths, {
  parent = join(homedir(), 'Library/Application Support/AI-Workbench-Web系统助手'), verify = verifySignedWebDirectory, evidenceOptions = {},
} = {}) {
  await privateDirectory(parent);
  const evidenceRoot = join(parent, '助手签名证明');
  await privateDirectory(evidenceRoot);
  const bindingFile = join(parent, '当前助手.json'), binding = await readState(bindingFile);
  if (binding) {
    if (!/^[a-f0-9]{64}$/.test(binding.sha256)) fail('invalid_keychain_helper');
    const result = await verifyHelperEvidence(join(evidenceRoot, binding.sha256), inventory.helper.sourceSHA256, join(parent, binding.sha256), evidenceOptions);
    if (result.helperSHA256 !== binding.sha256) fail('invalid_keychain_helper');
    return result;
  }
  let source = packageRoot, selected = inventory;
  const state = await readState(paths.state);
  // 过渡时当前指针可能已经提交新版，原助手来自previous。只信安装器已验签的版本，
  // 不扫描任意目录，不仅凭一个本地哈希文件信任可执行程序。
  for (const identity of [state?.current, ...(state?.phase === 'committed' ? [state.previous] : [])].filter(Boolean)) {
    const candidate = versionPath(paths, identity);
    if (candidate === packageRoot) continue;
    const verified = await verify(candidate, { releaseVersion: identity.version });
    if (verified.inventory.helper.sourceSHA256 !== inventory.helper.sourceSHA256) fail('keychain_helper_migration_required');
    const oldDirectory = join(parent, verified.inventory.helper.sha256);
    try {
      const existing = await bytes(join(oldDirectory, '系统钥匙串'), 16 * 1024 * 1024);
      if (sha256(existing) !== verified.inventory.helper.sha256) fail('invalid_keychain_helper');
      source = candidate; selected = verified.inventory; break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const directory = join(parent, selected.helper.sha256);
  await privateDirectory(directory);
  const evidenceDirectory = join(evidenceRoot, selected.helper.sha256);
  await privateDirectory(evidenceDirectory);
  const allowed = new Set(['系统钥匙串']);
  if ((await readdir(directory)).some(name => !allowed.has(name))) fail('invalid_keychain_helper');
  try { await copyFile(join(source, '系统助手/系统钥匙串'), join(directory, '系统钥匙串'), 1); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  for (const name of ['工作台发布.json', ...WEB_MANIFEST_NAMES]) await writePrivateFile(join(evidenceDirectory, name), await readFile(join(source, name)));
  const result = await verifyHelperEvidence(evidenceDirectory, inventory.helper.sourceSHA256, directory, evidenceOptions);
  await writeState(bindingFile, { sha256: result.helperSHA256 });
  return result;
}
