import { lstat, readdir, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readState, versionPath } from './Web安装目录.mjs';
import { fail, WEB_MANIFEST_NAMES } from './Web发布协议.mjs';
import { compareVersions } from '../软件更新/stable-version.mjs';
import { 清理更新缓存 } from '../软件更新/更新缓存限制.mjs';

// 只由持锁管理器调用；保留所有事务引用（当前、回退、目标和待安装版本）。
export async function 清理过期安装版本(paths, { clearInterrupted = false } = {}) {
  const state = paths.state ? await readState(paths.state) : null;
  if (!state?.current) return { removed: 0 };
  const stage = await readState(join(paths.root, '待安装版本.json'));
  const keep = new Set([state.current, state.previous, state.target, stage?.next].filter(Boolean).map(identity => versionPath(paths, identity)));
  const root = await lstat(paths.versions);
  if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid() || root.mode & 0o077) fail('web_install_root_invalid');
  let removed = 0;
  for (const name of await readdir(paths.versions)) {
    if (!/^[0-9A-Za-z.+-]+-[a-f0-9]{40}$/.test(name) && !(clearInterrupted && /^暂存-[a-f0-9-]{36}$/.test(name))) continue;
    const folder = join(paths.versions, name);
    if (keep.has(folder)) continue;
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) fail('web_install_root_invalid');
    await rm(folder, { recursive: true, force: true }); removed++;
  }
  return { removed };
}

// 只在新版本健康确认且提交指针后调用。启动时也补清中途退出遗留的已安装包。
export async function 清理已完成Web安装(paths, downloadDirectory) {
  const state = await readState(paths.state);
  if (!state?.current || !['committed', 'rolled-back'].includes(state.phase)) fail('update_activation_unconfirmed');
  const result = await 清理更新缓存(downloadDirectory, { currentVersion: state.current.version, manifestNames: WEB_MANIFEST_NAMES, installedOnly: true });
  const stageFile = join(paths.root, '待安装版本.json'), staged = await readState(stageFile);
  if (staged?.next && compareVersions(staged.next.version, state.current.version) <= 0) await unlink(stageFile);
  await 清理过期安装版本(paths);
  return result;
}
