import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录, 上游目录, 基线, 检查 } from './公共.mjs';
检查();
const target = join(根目录, '.运行', 基线.提交);
if (!existsSync(target)) {
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const archive = execFileSync('git', ['-C', 上游目录, 'archive', 基线.提交], { maxBuffer: 128 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', target], { input: archive });
}
// Use the upstream pnpm lock; npm's lock is stale in this upstream version.
execFileSync('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: join(target, 'web'), stdio: 'inherit' });
console.log('运行副本已准备；原作者目录未写入依赖或构建产物。');
