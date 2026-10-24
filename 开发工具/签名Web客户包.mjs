import assert from 'node:assert/strict';
import { sign, createPublicKey, createPrivateKey } from 'node:crypto';
import { readFile, lstat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_APP, WEB_REPOSITORY, WEB_MANIFEST_NAMES, validateWebManifest, verifyWebManifest, sha256 } from '../扩展功能/客户安装/Web发布协议.mjs';
import { verifyWebDirectory } from '../扩展功能/客户安装/Web安装包核验.mjs';
import { keyId } from '../扩展功能/软件更新/stable-manifest.mjs';
import { STABLE_TRUSTED_KEYS } from '../扩展功能/软件更新/stable-trust.mjs';
import { assertWebReleaseSource } from './Web发布源码核对.mjs';

export async function signWebPackage({ record, privateKey, approval, trustedKeys = STABLE_TRUSTED_KEYS }) {
  assert.equal(approval.repository, WEB_REPOSITORY); assert.equal(approval.approvedBy, 'Champion-Guan');
  assert.equal(approval.commit, record.commit); assert.equal(approval.tag, 'web-v' + record.version);
  assert.equal(privateKey.asymmetricKeyType, 'ed25519');
  const id = keyId(createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }));
  assert.ok(Object.hasOwn(trustedKeys, id));
  const m = validateWebManifest({ format: 1, app: WEB_APP, channel: 'web-preview', repository: WEB_REPOSITORY, version: record.version,
    commit: record.commit, builtAt: new Date().toISOString(), keyId: id, inventorySHA256: record.inventorySHA256, packages: [record.descriptor] });
  const archive = await readFile(record.archive);
  assert.equal(archive.length, record.descriptor.size); assert.equal(sha256(archive), record.descriptor.sha256);
  await verifyWebDirectory(record.stage, { manifest: m, selected: record.descriptor });
  const bytes = Buffer.from(JSON.stringify(m, null, 2) + '\n'), signature = sign(null, bytes, privateKey);
  verifyWebManifest(bytes, signature, { trustedKeys, releaseVersion: record.version });
  const directory = resolve(record.archive, '..');
  for (const [name, content] of [[WEB_MANIFEST_NAMES[0], bytes], [WEB_MANIFEST_NAMES[1], signature]]) await writeFile(join(directory, name), content, { flag: 'wx', mode: 0o600 });
  return { version: record.version, keyId: id, signed: true, channel: 'web-preview' };
}
async function ownerSigning(recordFile, backupDirectory) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const run = args => execFileSync('gh', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GH_DEBUG: '' } }).toString().trim();
  const git = args => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const user = JSON.parse(run(['api', 'user'])), repository = JSON.parse(run(['api', 'repos/' + WEB_REPOSITORY]));
  // 独立于原Stable的预发布签名入口，保留相同的所有者身份和固定公钥约束。
  assert.equal(user.login, 'Champion-Guan'); assert.equal(user.id, 87700227); assert.equal(repository.owner.id, 87700227); assert.equal(repository.permissions.admin, true);
  assert.equal(git(['remote', 'get-url', 'origin']).replace(/\.git$/, ''), 'https://github.com/' + WEB_REPOSITORY);
  assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '');
  const record = JSON.parse(await readFile(recordFile, 'utf8'));
  assert.equal(record.releaseReady, true);
  assertWebReleaseSource(root, record.commit, record.sourceSHA256);
  assert.equal(record.commit, git(['rev-parse', 'HEAD']));
  const tag = 'web-v' + record.version; assert.equal(git(['rev-parse', tag + '^{commit}']), record.commit);
  const bounded = async (file, maxBytes) => {
    const s = await lstat(file); assert.ok(s.isFile() && !s.isSymbolicLink() && s.uid === process.getuid() && !(s.mode & 0o077) && s.size <= maxBytes);
    return readFile(file);
  };
  const s = await lstat(backupDirectory); assert.ok(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() && !(s.mode & 0o077));
  const keyRecord = JSON.parse(await bounded(join(backupDirectory, 'BOOTSTRAP.json'), 8192));
  assert.ok(keyRecord.backupVerified && keyRecord.keychainNamespace === 'production' && Object.hasOwn(STABLE_TRUSTED_KEYS, keyRecord.keyId));
  assert.equal(keyRecord.encryptedPrivateFile, 'signing-key.encrypted.pem');
  const encrypted = await bounded(join(backupDirectory, keyRecord.encryptedPrivateFile), 8192); assert.equal(sha256(encrypted), keyRecord.encryptedSha256);
  const [{ MacKeychainVault }, { runtimePaths }] = await Promise.all([import('../src/server/keychain-vault.mjs'), import('../src/server/runtime-paths.mjs')]);
  const vault = new MacKeychainVault({ executable: join(runtimePaths({ projectRoot: root }).runtime, 'guan-keychain') });
  const passphrase = await vault.read(keyRecord.account); assert.ok(passphrase);
  const privateKey = createPrivateKey({ key: encrypted, format: 'pem', passphrase });
  return signWebPackage({ record, privateKey, approval: { repository: WEB_REPOSITORY, approvedBy: user.login, commit: record.commit, tag } });
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 5); assert.equal(process.argv[4], 'RELEASE-WEB-PREVIEW');
    console.log(JSON.stringify(await ownerSigning(resolve(process.argv[2]), resolve(process.argv[3]))));
  } catch { console.error('Web预发布签名未完成。请核实所有者登录、固定提交/标签及既有加密密钥备份；未发布或修改正式版。'); process.exitCode = 1; }
}
