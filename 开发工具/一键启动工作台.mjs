import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { isWorkbenchOrigin } from '../扩展功能/本机服务/工作台端口.mjs';
import { 创建有界运行日志 } from '../扩展功能/本机服务/有界运行日志.mjs';

const run = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shell = value => "'" + value.replaceAll("'", "'\\''") + "'";
const marker = 'AI-Workbench desktop launcher\n';

function writeChanged(path, bytes, mode = 0o600) {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('桌面入口含未知链接，未覆盖。');
    if (readFileSync(path).equals(Buffer.from(bytes))) { if ((info.mode & 0o777) !== mode) chmodSync(path, mode); return; }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path + '.写入-' + process.pid;
  try { writeFileSync(temporary, bytes, { flag: 'wx', mode }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}

// 桌面只保存小型转发入口和图标，业务、依赖、数据始终留在本机项目中。
export function 创建桌面入口({ root = projectRoot, desktop = join(homedir(), 'Desktop') } = {}) {
  const bundle = join(desktop, 'AI-Workbench.app');
  const target = join(root, '生图工作台.app/Contents/MacOS/启动工作台');
  const icon = readFileSync(join(root, '生图工作台.app/Contents/Resources/工作台图标.icns'));
  if (!existsSync(target)) throw Error('项目启动入口缺失。');
  let created = false;
  try {
    const info = lstatSync(bundle);
    if (!info.isDirectory() || info.isSymbolicLink() || readFileSync(join(bundle, 'Contents/guan-workbench-shortcut'), 'utf8') !== marker) throw Error('桌面已有其他同名应用，未覆盖。');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (existsSync(bundle)) throw Error('桌面已有其他同名应用，未覆盖。');
    mkdirSync(bundle, { mode: 0o700 }); created = true;
  }
  for (const name of ['Contents', 'Contents/MacOS', 'Contents/Resources']) {
    const directory = join(bundle, name);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw Error('桌面入口目录异常，未覆盖。');
  }
  const plist = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.guanaiworkbench.development.desktop</string>
<key>CFBundleName</key><string>AI-Workbench</string>
<key>CFBundleDisplayName</key><string>AI-Workbench</string>
<key>CFBundleExecutable</key><string>launch</string>
<key>CFBundleIconFile</key><string>工作台图标.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/>
</dict></plist>\n`;
  writeChanged(join(bundle, 'Contents/Info.plist'), plist);
  writeChanged(join(bundle, 'Contents/guan-workbench-shortcut'), marker);
  writeChanged(join(bundle, 'Contents/Resources/工作台图标.icns'), icon);
  writeChanged(join(bundle, 'Contents/MacOS/launch'), '#!/bin/zsh\nexec ' + shell(target) + '\n', 0o700);
  // 只回收本应用旧启动器已不再引用的固定文件，不保留两套入口实现。
  for (const name of ['Contents/MacOS/probe.js', 'Contents/Resources/AppIcon.png']) {
    const file = join(bundle, name);
    try { const info = lstatSync(file); if (info.isFile() && !info.isSymbolicLink() && info.nlink === 1) rmSync(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { path: bundle, created };
}

async function manager(operation) {
  const { stdout } = await run(process.execPath, [join(projectRoot, '开发工具/开发版运行.mjs'), operation], {
    cwd: projectRoot, timeout: operation === 'start' ? 75000 : 7000, maxBuffer: 64 * 1024 });
  return JSON.parse(stdout);
}

export async function 启动并打开工作台({ readStatus = () => manager('status'), startService = () => manager('start'),
  openPage = origin => run('/usr/bin/open', [origin], { timeout: 15000 }), wait = delay, timeoutMs = 180000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let state = await readStatus();
  if (!state.running) { await startService(); state = await readStatus(); }
  do {
    if (state.running && state.ready && state.http === 200) {
      if (!isWorkbenchOrigin(state.origin)) throw Error('服务返回的地址不属于本机工作台，未打开网页。');
      await openPage(state.origin);
      return state;
    }
    if (state.failedAt && !state.running) throw Error('工作台启动失败，请查看同目录开发服务日志。');
    if (Date.now() >= deadline) break;
    await wait(intervalMs); state = await readStatus();
  } while (true);
  throw Error('工作台尚未就绪，未打开其他端口。请查看开发服务日志后重试。');
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const log = 创建有界运行日志(join(projectRoot, '.运行/开发版3100/一键启动.log'), { maxBytes: 128 * 1024, files: 2 });
  try {
    try { const shortcut = 创建桌面入口(); log.write('桌面入口已就绪：' + shortcut.path + '\n'); }
    catch (error) { log.write('桌面入口未更新：' + error.message + '\n'); }
    const state = await 启动并打开工作台();
    log.write(new Date().toISOString() + ' 工作台已打开：' + state.origin + '\n');
    console.log('工作台已打开：' + state.origin);
  } catch {
    log.write(new Date().toISOString() + ' 启动未完成，请检查开发服务.log；未停止其他服务或改写产品数据。\n');
    process.exitCode = 1;
  }
}
