import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { 根目录, 检查 } from './公共.mjs';
检查();
const hooks = resolve(根目录, execFileSync('git', ['rev-parse', '--git-path', 'guan-hooks'], { cwd: 根目录, encoding: 'utf8' }).trim());
mkdirSync(hooks, { recursive: true });
for (const name of ['pre-commit', 'pre-push']) {
  const file = join(hooks, name);
  copyFileSync(join(根目录, '开发工具', '提交前检查'), file);
  chmodSync(file, 0o755);
}
execFileSync('git', ['config', 'core.hooksPath', hooks], { cwd: 根目录 });
console.log('本仓库提交与推送保护已安装；移动目录或重新克隆后请再运行一次。');
