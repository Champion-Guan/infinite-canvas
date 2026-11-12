import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 创建桌面入口 } from './一键启动工作台.mjs';

const run = promisify(execFile);
async function refreshEntry(path) {
  await run('/usr/bin/touch', [path], { timeout: 5000 });
  await run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    ['-f', path], { timeout: 10000 });
}

export async function 修复项目桌面入口({ root, desktop, refresh = refreshEntry } = {}) {
  const result = 创建桌面入口({ root, desktop });
  await refresh(result.path);
  return { ...result, repaired: true };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    const result = await 修复项目桌面入口();
    console.log('AI-Workbench桌面入口已修复：' + result.path);
  } catch (error) {
    console.error('桌面入口未修复：' + (error.message || '请检查项目启动文件和桌面访问权限。'));
    process.exitCode = 1;
  }
}
