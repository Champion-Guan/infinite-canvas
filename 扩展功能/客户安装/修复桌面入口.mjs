import { webInstallPaths, readState, versionPath } from './Web安装目录.mjs';
import { verifySignedWebDirectory } from './Web安装包核验.mjs';
import { ensureDesktopEntry } from './客户桌面入口.mjs';
import { WEB_APP, fail } from './Web发布协议.mjs';

// 只修复稳定转发入口；安装指针、服务、工作区和生成任务均不写入。
export async function repairInstalledDesktopEntry(paths = webInstallPaths(), {
  desktopDirectory, readInstallation = readState, verifyDirectory = verifySignedWebDirectory,
  ensureEntry = ensureDesktopEntry,
} = {}) {
  const state = await readInstallation(paths.state);
  if (!state?.current) fail('web_install_required');
  if (state.app !== WEB_APP) fail('update_state_invalid');
  const packageRoot = versionPath(paths, state.current);
  const verified = await verifyDirectory(packageRoot, { releaseVersion: state.current.version });
  if (verified.inventory.commit !== state.current.commit) fail('release_identity_mismatch');
  const result = await ensureEntry(paths, desktopDirectory ? { desktopDirectory } : {});
  return { ...result, version: state.current.version, repaired: true };
}
