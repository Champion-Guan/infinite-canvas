import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { 执行有界构建命令 } from './有界构建进程.mjs';

export async function 准备开发构建环境({ root, web, upstream, commit, run = 执行有界构建命令 }) {
  // 装配只重放改动文件；被清理的基线配置和依赖必须在冷启动构建前补齐。
  const files = execFileSync('git', ['ls-tree', '-rz', '--name-only', commit, 'web', 'VERSION', 'CHANGELOG.md'],
    { cwd: upstream, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const name of files) {
    const target = join(dirname(web), name);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, execFileSync('git', ['show', commit + ':' + name], { cwd: upstream }), { flag: 'wx' });
    }
  }
  for (const [source, target] of [['Web前端依赖.json', 'package.json'], ['Web前端依赖锁.json', 'package-lock.json']]) {
    const bytes = readFileSync(join(root, '开发工具', source)), path = join(web, target);
    if (!existsSync(path) || !readFileSync(path).equals(bytes)) writeFileSync(path, bytes);
  }
  const runtimeRoot = join(root, '.运行/3100源');
  for (const [source, target] of [['Web运行依赖.json', 'package.json'], ['Web运行依赖锁.json', 'package-lock.json']]) {
    const bytes = readFileSync(join(root, '开发工具', source)), path = join(runtimeRoot, target);
    if (!existsSync(path) || !readFileSync(path).equals(bytes)) writeFileSync(path, bytes);
  }
  const npm = resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
  if (!existsSync(npm)) throw Error('开发构建依赖缺失，且当前 Node.js 未附带 npm。请修复本机 Node.js 安装后重试。');
  async function installLocked(directory, lockName, receiptName, required, cacheName) {
    const require = createRequire(join(directory, 'package.json'));
    const fingerprint = createHash('sha256').update(readFileSync(join(directory, lockName))).digest('hex');
    const receipt = join(directory, 'node_modules', receiptName);
    if (existsSync(receipt) && readFileSync(receipt, 'utf8') === fingerprint) {
      try {
        for (const name of required) require.resolve(name);
        return;
      } catch {}
    }
    const cache = join(root, '.运行/开发版3100', cacheName);
    try {
      await run(process.execPath, [npm, 'ci', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund',
        '--fetch-retries=6', '--fetch-timeout=120000', '--cache', cache], {
        cwd: directory, env: { ...process.env, PATH: dirname(process.execPath) + ':' + (process.env.PATH || '') },
        budgetDirectory: join(root, '.运行/3100源'), maxBytes: 4 * 1024 ** 3, reserveBytes: 3 * 1024 ** 3, timeout: 900000,
      });
      writeFileSync(receipt, fingerprint, { mode: 0o600 });
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  }
  await installLocked(web, 'package-lock.json', '.开发依赖指纹',
    ['vite', '@vitejs/plugin-react', '@tailwindcss/postcss', 'react', 'typescript'], 'npm-cache');
  await installLocked(runtimeRoot, 'package-lock.json', '.运行依赖指纹', ['undici', 'yaml'], '运行依赖缓存');
}
