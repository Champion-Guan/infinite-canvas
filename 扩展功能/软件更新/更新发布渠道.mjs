import { join } from 'node:path';
import { parseVersion } from './stable-version.mjs';
import { readPrivateFile, writePrivateJson } from './runtime-paths.mjs';
import { UpdateError } from './update-auth.mjs';

export function acceptsUpdateVersion(version, developerMode = false) {
  const parsed = parseVersion(version);
  return Boolean(parsed && (!parsed.pre.length || developerMode === true && parsed.pre[0] === 'beta'));
}

// GitHub 的发布标志和版本号必须一致；旧桌面版 v* 不属于 Web 更新渠道。
export function acceptsWebRelease(release, { developerMode = false } = {}) {
  const version = parseVersion(release?.tag_name?.replace(/^web-v/, ''));
  return Boolean(version && release.tag_name === 'web-v' + version.version && release.draft === false &&
    release.prerelease === Boolean(version.pre.length) && acceptsUpdateVersion(version.version, developerMode));
}

export function requireUpdateChannel(version, preferences) {
  if (!acceptsUpdateVersion(version, preferences.developerMode)) throw new UpdateError('update_channel_excluded');
}

// 管理器在恢复安装确认和真正切换前独立读取偏好，不能只相信页面曾经选过 Beta。
export async function readUpdateDeveloperMode(directory) {
  try {
    const raw = await readPrivateFile(join(directory, '开发者更新偏好.json'), { maxBytes: 4096 });
    if (raw === null) return false;
    const preferences = JSON.parse(raw);
    if (!preferences || preferences.version !== 1 || Array.isArray(preferences) || typeof preferences.developerMode !== 'boolean' ||
      Object.keys(preferences).some(key => !['version', 'developerMode'].includes(key))) throw Error();
    return preferences.developerMode === true;
  } catch { throw new UpdateError('update_storage_invalid'); }
}

export function saveUpdateDeveloperMode(directory, developerMode) {
  if (typeof developerMode !== 'boolean') throw new UpdateError('invalid_update_preferences');
  // 不向旧 preferences.json 增加字段，旧版本回退后仍可读取自己的配置。
  return writePrivateJson(join(directory, '开发者更新偏好.json'), { version: 1, developerMode });
}

export async function requireSavedUpdateChannel(directory, version) {
  requireUpdateChannel(version, { developerMode: await readUpdateDeveloperMode(directory) });
}
