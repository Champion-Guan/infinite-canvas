import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmod, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { webInstallPaths } from './Web安装目录.mjs';
import { WEB_APP, fail } from './Web发布协议.mjs';
import { isWorkbenchOrigin } from '../本机服务/工作台端口.mjs';

const execFileAsync = promisify(execFile);
const 桌面入口名称 = '生图工作台.app';
const 入口标记相对路径 = 'Contents/Resources/生图工作台-桌面入口标记.json';
const 启动脚本相对路径 = 'Contents/MacOS/启动工作台';
const 信息文件相对路径 = 'Contents/Info.plist';
const 图标相对路径 = 'Contents/Resources/工作台图标.icns';
const 图标来源 = fileURLToPath(new URL('./工作台图标.icns', import.meta.url));

export function desktopEntryPath(home = homedir(), desktopDirectory = join(home, 'Desktop')) {
  return join(desktopDirectory, 桌面入口名称);
}

function 入口标记() {
  return JSON.stringify({ format: 1, app: WEB_APP, name: '生图工作台', launcher: '当前安装版本' }, null, 2) + '\n';
}

function 启动脚本() {
  return `#!/bin/sh
set -eu

GUAN_INSTALL_ROOT="${'${HOME:?}/Library/Application Support/AI-Workbench-Web安装'}"
GUAN_STATE="$GUAN_INSTALL_ROOT/当前版本.json"
GUAN_VERSION=$(/usr/bin/sed -n 's/^[[:space:]]*"name"[[:space:]]*:[[:space:]]*"\\([^"\\]*\\)".*/\\1/p' "$GUAN_STATE" | /usr/bin/head -n 1)
case "$GUAN_VERSION" in
  ''|*[!A-Za-z0-9.+-]*) echo '工作台安装状态无效。' >&2; exit 1 ;;
esac
GUAN_VERSION_ROOT="$GUAN_INSTALL_ROOT/版本/$GUAN_VERSION"
GUAN_NODE="$GUAN_VERSION_ROOT/runtime/node"
GUAN_COMMAND="$GUAN_VERSION_ROOT/扩展功能/客户安装/Web客户命令.mjs"
if [ ! -x "$GUAN_NODE" ] || [ ! -f "$GUAN_COMMAND" ]; then
  echo '工作台当前版本不完整，请重新安装或更新。' >&2
  exit 1
fi
exec "$GUAN_NODE" "$GUAN_COMMAND" desktop-start
`;
}

function 信息文件() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key><string>生图工作台</string>
  <key>CFBundleExecutable</key><string>启动工作台</string>
  <key>CFBundleIdentifier</key><string>com.championguan.guan-web-workbench</string>
  <key>CFBundleIconFile</key><string>工作台图标.icns</string>
  <key>CFBundleName</key><string>生图工作台</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict>
</plist>
`;
}

async function 真实目录(path, { desktop = false } = {}) {
  let info;
  try { info = await lstat(path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(path, { recursive: true, mode: 0o700 }); info = await lstat(path);
  }
  if (!info || !info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) fail('desktop_entry_conflict');
  if (!desktop && info.mode & 0o077) fail('web_install_root_invalid');
  return info;
}

async function 写入若有变化(path, contents, mode) {
  let current = null;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid()) fail('desktop_entry_conflict');
    current = await readFile(path);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const changed = !current?.equals(bytes);
  if (changed) await writeFile(path, bytes, { mode });
  await chmod(path, mode);
  return changed;
}

async function 校验已有入口(path) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) fail('desktop_entry_conflict');
  for (const directory of ['Contents', 'Contents/Resources']) {
    const directoryInfo = await lstat(join(path, directory)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!directoryInfo?.isDirectory() || directoryInfo.isSymbolicLink() || directoryInfo.uid !== process.getuid()) fail('desktop_entry_conflict');
  }
  const marker = join(path, 入口标记相对路径);
  let value;
  try {
    const markerInfo = await lstat(marker);
    if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.uid !== process.getuid() || markerInfo.size > 4096) fail('desktop_entry_conflict');
    value = JSON.parse(await readFile(marker, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') fail('desktop_entry_conflict');
    throw error;
  }
  if (value?.format !== 1 || value.app !== WEB_APP || value.name !== '生图工作台') fail('desktop_entry_conflict');
  return true;
}

async function 写入入口(path) {
  const contents = join(path, 'Contents'), macos = join(contents, 'MacOS'), resources = join(contents, 'Resources');
  await 真实目录(contents); await 真实目录(macos); await 真实目录(resources);
  let changed = await 写入若有变化(join(path, 信息文件相对路径), 信息文件(), 0o600);
  const launcher = join(path, 启动脚本相对路径);
  changed = await 写入若有变化(launcher, 启动脚本(), 0o700) || changed;
  changed = await 写入若有变化(join(path, 图标相对路径), await readFile(图标来源), 0o600) || changed;
  changed = await 写入若有变化(join(path, 入口标记相对路径), 入口标记(), 0o600) || changed;
  if (changed) {
    // 原位修复后更新Finder/LaunchServices缓存，不触碰其他应用或全局图标缓存。
    await execFileAsync('/usr/bin/touch', [path], { timeout: 5000 });
    await execFileAsync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
      ['-f', path], { timeout: 10000 }).catch(() => {});
  }
  return changed;
}

export async function ensureDesktopEntry(paths = webInstallPaths(), { desktopDirectory = join(homedir(), 'Desktop') } = {}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('architecture_unsupported');
  await 真实目录(paths.root);
  await 真实目录(desktopDirectory, { desktop: true });
  const target = desktopEntryPath(homedir(), desktopDirectory);
  const existed = await 校验已有入口(target);
  if (existed) return { path: target, created: false, updated: await 写入入口(target) };
  let claimed = false;
  try {
    try { await mkdir(target, { mode: 0o700 }); claimed = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!await 校验已有入口(target)) throw error;
      return { path: target, created: false, updated: await 写入入口(target) };
    }
    await 写入入口(target);
    return { path: target, created: true, updated: true };
  } catch (error) { if (claimed) await rm(target, { recursive: true, force: true }); throw error; }
}

export async function openWorkbenchAddress(address) {
  if (!isWorkbenchOrigin(address)) fail('web_address_invalid');
  try { await execFileAsync('/usr/bin/open', [address], { stdio: 'ignore', timeout: 15_000 }); }
  catch { fail('web_open_failed'); }
  return address;
}
