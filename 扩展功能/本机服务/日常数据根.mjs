import { lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { requireValue } from '../本机存储/协议.mjs';

// 独立于旧工作台；不借用浏览器Origin、旧数据目录或iCloud作为主数据库。
export function dailyWorkbenchPaths(applicationSupport = join(homedir(), 'Library/Application Support')) {
  requireValue(typeof applicationSupport === 'string' && isAbsolute(applicationSupport), 'invalid_daily_root', '必须明确使用本机应用数据父目录。');
  const container = join(applicationSupport, 'AI-Workbench-重建版');
  return Object.freeze({ applicationSupport, container, dataRoot: join(container, '工作区') });
}

function privateDirectory(path, parent = false) {
  const stat = lstatSync(path);
  requireValue(!stat.isSymbolicLink() && stat.isDirectory() && stat.uid === process.getuid() &&
    (stat.mode & (parent ? 0o022 : 0o077)) === 0, 'unsafe_daily_root', '日常数据目录类型、所有者或权限不安全；未自动修复。');
}
function present(path) {
  try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// 仅供可信本机启动器调用。测试可传全新临时父目录；正式入口不提供路径覆盖选项。
// 不创建工作区本体，不清文件；数据库及工作区标记仍完全交给原存储层校验。
export function prepareDailyDataRoot({ applicationSupport, initialize = false } = {}) {
  requireValue(typeof initialize === 'boolean', 'invalid_daily_root', '初始化选择必须明确。');
  const plan = dailyWorkbenchPaths(applicationSupport);
  privateDirectory(plan.applicationSupport, true);
  const parent = realpathSync(plan.applicationSupport);
  const paths = dailyWorkbenchPaths(parent);
  if (!present(paths.container)) {
    requireValue(initialize, 'daily_initialization_required', '日常工作区不存在，须明确首次初始化。');
    mkdirSync(paths.container, { mode: 0o700 });
  }
  privateDirectory(paths.container);
  requireValue(readdirSync(paths.container).every(name => {
    if (name === '工作区') return true;
    if (name !== '.DS_Store') return false;
    // Finder目录显示元数据不是工作区数据；仅接受本用户的普通小文件，原样保留。
    const metadata = lstatSync(join(paths.container, name));
    return metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1 && metadata.uid === process.getuid() && metadata.size <= 1024 * 1024;
  }), 'unknown_daily_root', '日常目录包含未知文件，未接管或清理。');
  if (present(paths.dataRoot)) {
    privateDirectory(paths.dataRoot);
    requireValue(!initialize || readdirSync(paths.dataRoot).length === 0, 'daily_initialization_denied', '已有工作区不能再次初始化；请正常重开。');
  } else requireValue(initialize, 'daily_initialization_required', '工作区不存在，未自动新建空库。');
  return paths.dataRoot;
}
