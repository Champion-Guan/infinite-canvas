import { lstat, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { compareVersions } from '../软件更新/stable-version.mjs';
import { extractSignedWebPackage, verifySignedWebDirectory } from './Web安装包核验.mjs';
import { readState, writeState, versionIdentity, versionPath } from './Web安装目录.mjs';
import { WEB_APP, WEB_REPOSITORY, exact, fail, sha256 } from './Web发布协议.mjs';

const file = paths => join(paths.root, '待安装版本.json');
const manifestHash = verified => sha256(Buffer.from(JSON.stringify(verified.manifest)));
export function validateStageIdentity(identity, current) {
  if (!exact(identity, ['repository', 'version', 'downloadId']) || identity.repository !== WEB_REPOSITORY ||
    !/^verified-[a-f0-9-]{36}$/.test(identity.downloadId) || compareVersions(identity.version, current.version) <= 0) fail('update_stage_invalid');
}
export async function restoreWebStage(paths, workspaceId, current, options = {}) {
  const record = await readState(file(paths));
  if (!record) return null;
  if (!exact(record, ['app', 'workspaceId', 'identity', 'next', 'manifestHash']) || record.app !== WEB_APP ||
    record.workspaceId !== workspaceId || !/^[a-f0-9]{64}$/.test(record.manifestHash)) fail('update_state_invalid');
  if (compareVersions(record.next?.version, current.version) <= 0) return null;
  validateStageIdentity(record.identity, current);
  const verified = await verifySignedWebDirectory(versionPath(paths, record.next), { ...options, releaseVersion: record.identity.version, currentVersion: current.version });
  if (JSON.stringify(versionIdentity(verified.inventory)) !== JSON.stringify(record.next) || manifestHash(verified) !== record.manifestHash) fail('update_stage_invalid');
  return { identity: record.identity, next: record.next };
}
// 暂存和确认分开。只持久化已复核的包身份，绝不保存自动安装许可。
export async function stageWebPackage({ paths, workspaceId, current, identity, download, options = {} }) {
  validateStageIdentity(identity, current);
  if (typeof workspaceId !== 'string' || !workspaceId) fail('update_stage_invalid');
  const info = await lstat(download);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077) fail('update_stage_invalid');
  // 失败残留保留供追溯；随机暂存路径允许安全重试，禁止覆盖既有版本。
  const destination = join(paths.versions, '暂存-' + randomUUID());
  const verifyOptions = { ...options, repository: WEB_REPOSITORY, releaseVersion: identity.version, currentVersion: current.version };
  const verified = await extractSignedWebPackage(download, destination, verifyOptions), next = versionIdentity(verified.inventory);
  const target = versionPath(paths, next);
  let exists = false;
  try { await lstat(target); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (exists) {
    const existing = await verifySignedWebDirectory(target, verifyOptions);
    if (manifestHash(existing) !== manifestHash(verified)) fail('update_stage_invalid');
  } else await rename(destination, target);
  await writeState(file(paths), { app: WEB_APP, workspaceId, identity, next, manifestHash: manifestHash(verified) });
  return { identity, next };
}
