import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const 根目录 = fileURLToPath(new URL('../', import.meta.url));
export const 上游目录 = fileURLToPath(new URL('../../infinite-canvas-upstream/', import.meta.url));
export const 基线 = JSON.parse(readFileSync(new URL('../上游基线.json', import.meta.url)));
export const git = (...args) => execFileSync('git', ['-C', 上游目录, ...args], { encoding: 'utf8' }).trim();
export function 检查仓库(目录, 提交) {
  const 查询 = (...args) => execFileSync('git', ['-C', 目录, ...args], { encoding: 'utf8' }).trim();
  if (查询('rev-parse', 'HEAD') !== 提交) throw Error('上游提交与锁定基线不一致，请先审查更新。');
  if (查询('status', '--porcelain', '--untracked-files=all')) throw Error('原作者目录有改动，禁止继续；不要自动清理或覆盖。');
}
export function 检查() {
  检查仓库(上游目录, 基线.提交);
  if (git('remote', 'get-url', 'upstream') !== 基线.仓库) throw Error('上游远程地址与基线不一致。');
  git('merge-base', '--is-ancestor', 基线.提交, 'upstream/main');
  console.log('上游源码干净，提交与基线一致。');
}
