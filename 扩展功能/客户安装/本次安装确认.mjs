import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { readState, writeState } from './Web安装目录.mjs';

const file = paths => join(paths.root, '本次安装确认.json');
export async function clearInstallConfirmation(paths) {
  await unlink(file(paths)).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
export async function saveInstallConfirmation(paths, workspaceId, current, staged, now = Date.now()) {
  await writeState(file(paths), { workspaceId, current, staged, expiresAt: now + 30 * 60 * 1000 });
}
// 仅恢复同一工作区、原版本、已再次验签的同一个包，30分钟内的单次人工确认。
// 恢复确认不绕过零页面、任务账本、保存排空与独占锁检查。
export async function restoreInstallConfirmation(paths, workspaceId, current, staged, now = Date.now()) {
  const value = await readState(file(paths));
  if (!value) return false;
  return Boolean(staged && value.workspaceId === workspaceId && JSON.stringify(value.current) === JSON.stringify(current) &&
    JSON.stringify(value.staged) === JSON.stringify(staged) && Number.isSafeInteger(value.expiresAt) &&
    value.expiresAt > now && value.expiresAt <= now + 30 * 60 * 1000);
}
