import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = join(root, '.运行/图标构建');
mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(join(temporaryRoot, '工作台-'));
try {
  const iconset = join(directory, '工作台.iconset');
  mkdirSync(iconset, { mode: 0o700 });
  const source = join(root, '界面资源/首页原样资源/工作台Logo.png');
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = size * scale;
      execFileSync('/usr/bin/sips', ['-z', String(pixels), String(pixels), source, '--out',
        join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'pipe' });
    }
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(root, '扩展功能/客户安装/工作台图标.icns')]);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
