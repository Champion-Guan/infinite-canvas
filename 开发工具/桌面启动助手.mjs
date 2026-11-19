import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 执行有界构建命令 } from './有界构建进程.mjs';

const source = fileURLToPath(new URL('./桌面启动窗口.swift', import.meta.url));
const bundleName = 'AI-Workbench启动提示.app';

function requireRealDirectory(path) {
  try {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('桌面启动助手目录不安全。');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
}

function existingRealDirectory(path) {
  try {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('桌面启动助手目录不安全。');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function writeJSON(path, value) {
  const temporary = path + '.tmp-' + process.pid;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}

function bundleInfo() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.guanaiworkbench.startup-feedback</string>
<key>CFBundleName</key><string>AI-Workbench Startup</string>
<key>CFBundleDisplayName</key><string>AI-Workbench</string>
<key>CFBundleExecutable</key><string>AI-Workbench Startup</string>
<key>CFBundleIconFile</key><string>工作台图标.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>
`;
}

export async function 确保桌面启动助手(runtime, logo, { run = 执行有界构建命令 } = {}) {
  requireRealDirectory(runtime);
  const bundle = join(runtime, bundleName);
  const contents = join(bundle, 'Contents');
  const macos = join(contents, 'MacOS');
  const resources = join(contents, 'Resources');
  const executable = join(macos, 'AI-Workbench Startup');
  const sourceHash = createHash('sha256').update(readFileSync(source)).digest('hex');
  const receipt = join(contents, '源码指纹.json');

  const bundleExists = existingRealDirectory(bundle);
  if (bundleExists) {
    requireRealDirectory(bundle);
    const internalPathsExist = [contents, macos, resources].every(existingRealDirectory);
    if (internalPathsExist && existsSync(receipt) && existsSync(executable)) {
      const previous = JSON.parse(readFileSync(receipt, 'utf8'));
      const executableInfo = lstatSync(executable);
      if (previous.sourceSHA256 === sourceHash && executableInfo.isFile() && !executableInfo.isSymbolicLink()) return bundle;
    }
    if (!existsSync(receipt)) throw Error('桌面启动助手目标与本机生成包标记不符。');
  }

  const stageRoot = join(runtime, '启动助手构建-' + process.pid);
  try {
    requireRealDirectory(stageRoot);
    const stagedBundle = join(stageRoot, bundleName);
    const stagedContents = join(stagedBundle, 'Contents');
    const stagedMacOS = join(stagedContents, 'MacOS');
    const stagedResources = join(stagedContents, 'Resources');
    mkdirSync(stagedMacOS, { recursive: true, mode: 0o700 });
    mkdirSync(stagedResources, { recursive: true, mode: 0o700 });
    const stagedExecutable = join(stagedMacOS, 'AI-Workbench Startup');
    await run('/usr/bin/swiftc', ['-parse-as-library', '-O', '-framework', 'AppKit', '-framework', 'QuartzCore', source, '-o', stagedExecutable], {
      budgetDirectory: runtime, maxBytes: 128 * 1024 ** 2, reserveBytes: 1024 ** 3, timeout: 120000,
    });
    chmodSync(stagedExecutable, 0o700);
    writeFileSync(join(stagedContents, 'Info.plist'), bundleInfo(), { mode: 0o600 });
    if (existsSync(logo)) copyFileSync(logo, join(stagedResources, '工作台图标.icns'));
    writeJSON(join(stagedContents, '源码指纹.json'), { sourceSHA256: sourceHash, executable: basename(executable) });

    let previousBundle = null;
    if (bundleExists) {
      previousBundle = join(stageRoot, '旧启动助手.app');
      renameSync(bundle, previousBundle);
    }
    try {
      renameSync(stagedBundle, bundle);
    } catch (error) {
      if (previousBundle) renameSync(previousBundle, bundle);
      throw error;
    }
    return bundle;
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

