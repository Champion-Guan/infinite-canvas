import { createPublicKey, verify } from 'node:crypto';
import { keyId, sha256, MAX_STABLE_PACKAGE_BYTES } from '../软件更新/stable-manifest.mjs';
import { parseVersion, compareVersions } from '../软件更新/stable-version.mjs';
import { STABLE_TRUSTED_KEYS } from '../软件更新/stable-trust.mjs';
import { UpdateError } from '../软件更新/update-auth.mjs';
import { acceptsWebRelease } from '../软件更新/更新发布渠道.mjs';

export const WEB_REPOSITORY = 'Champion-Guan/infinite-canvas';
export const WEB_MANIFEST_NAMES = ['Web更新清单.json', 'Web更新清单.sig'];
// 已签名安装身份的兼容字段；实际监听地址由运行时从3000开始分配。
export const WEB_ORIGIN = 'http://localhost:3100';
export const WEB_APP = 'guan-web-workbench';
export const fail = code => { throw new UpdateError(code); };
export const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
export const packageName = version => `生图工作台Web-v${version}-macos-arm64.zip`;
// GitHub会剔除资产名中的中文。本地文件保留中文，远程协议只接受这三类固定映射。
export function webReleaseAssetName(name) {
  const index = WEB_MANIFEST_NAMES.indexOf(name);
  if (index >= 0) return ['Web.json', 'Web.sig'][index];
  const version = /^生图工作台Web-v(.+)-macos-arm64\.zip$/.exec(name)?.[1];
  if (version && parseVersion(version)?.version === version) return `Web-v${version}-macos-arm64.zip`;
  fail('release_assets_invalid');
}
export function validateWebManifest(m) {
  const v = parseVersion(m?.version);
  if (!exact(m, ['format', 'app', 'channel', 'repository', 'version', 'commit', 'builtAt', 'keyId', 'inventorySHA256', 'packages']) ||
    m.format !== 1 || m.app !== WEB_APP || (m.channel !== 'web-preview' && !(m.channel === 'web-stable' && v && !v.pre.length)) || m.repository !== WEB_REPOSITORY ||
    !v || v.version !== m.version || !/^[a-f0-9]{40}$/.test(m.commit) || !/^[a-f0-9]{64}$/.test(m.keyId) ||
    !/^[a-f0-9]{64}$/.test(m.inventorySHA256) || !Number.isFinite(Date.parse(m.builtAt)) || new Date(m.builtAt).toISOString() !== m.builtAt ||
    !Array.isArray(m.packages) || m.packages.length !== 1) fail('web_manifest_invalid');
  const p = m.packages[0];
  if (!exact(p, ['platform', 'arch', 'name', 'sha256', 'size', 'nodeVersion', 'runtimeSha256', 'runtimeSize']) ||
    p.platform !== 'darwin' || p.arch !== 'arm64' || p.name !== packageName(m.version) || !/^[a-f0-9]{64}$/.test(p.sha256) ||
    !Number.isSafeInteger(p.size) || p.size < 1 || p.size > MAX_STABLE_PACKAGE_BYTES || p.nodeVersion !== 'v24.16.0' ||
    !/^[a-f0-9]{64}$/.test(p.runtimeSha256) || !Number.isSafeInteger(p.runtimeSize) || p.runtimeSize < 1 || p.runtimeSize > 160 * 1024 * 1024) fail('web_manifest_invalid');
  return m;
}
export function verifyWebManifest(bytes, signature, { trustedKeys = STABLE_TRUSTED_KEYS, repository = WEB_REPOSITORY,
  releaseVersion, currentVersion, arch = process.arch, platform = process.platform } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 65536 || !Buffer.isBuffer(signature) || signature.length !== 64) fail('signature_invalid');
  let m; try { m = JSON.parse(bytes); } catch { fail('web_manifest_invalid'); }
  const pem = Object.hasOwn(trustedKeys, m?.keyId) && trustedKeys[m.keyId];
  if (!pem) fail('signing_key_untrusted');
  try { if (keyId(pem) !== m.keyId || !verify(null, bytes, createPublicKey(pem), signature)) fail('signature_invalid'); }
  catch { fail('signature_invalid'); }
  validateWebManifest(m);
  if (!Buffer.from(JSON.stringify(m, null, 2) + '\n').equals(bytes)) fail('web_manifest_invalid');
  if (repository !== WEB_REPOSITORY || releaseVersion && m.version !== releaseVersion) fail('release_identity_mismatch');
  if (currentVersion && compareVersions(m.version, currentVersion) <= 0) fail('version_not_newer');
  if (arch !== 'arm64' || platform !== 'darwin') fail('architecture_unsupported');
  return { manifest: m, selected: m.packages[0] };
}
export function selectWebRelease(releases, _token = '', { developerMode = false } = {}) {
  if (!Array.isArray(releases)) fail('invalid_release_response');
  let latest = null;
  for (const r of releases) {
    const v = parseVersion(r?.tag_name?.replace(/^web-v/, ''));
    if (!acceptsWebRelease(r, { developerMode }) ||
      !Number.isSafeInteger(r.id) || !Number.isFinite(Date.parse(r.published_at)) || !Array.isArray(r.assets) ||
      ![...WEB_MANIFEST_NAMES, packageName(v.version)].every(name => r.assets.filter(a => a?.name === webReleaseAssetName(name) && a.state === 'uploaded' && a.size > 0).length === 1)) continue;
    const assets = r.assets.filter(a => a?.state === 'uploaded' && typeof a.name === 'string' &&
      !/[\\/\x00-\x1f]/.test(a.name) && a.name.length <= 160 && Number.isSafeInteger(a.id) && a.id > 0 && Number.isSafeInteger(a.size) && a.size > 0)
      .map(({ name, id, size }) => ({ name, id, size }));
    if (!latest || compareVersions(v.version, latest.version) > 0) latest = { version: v.version,
      publishedAt: new Date(r.published_at).toISOString(), notes: String(r.body || '').slice(0, 32768), releaseId: r.id, verification: 'not-verified', assets };
  }
  return latest;
}
export { sha256 };
