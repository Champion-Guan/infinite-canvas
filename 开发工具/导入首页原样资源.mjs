import { constants, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { 根目录 } from './公共.mjs';
const old = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench/public/assets';
// 仅复制首页实际使用的公共资源；保留来源，不触及私有文件。
export const 原样资源 = [
  ['_next/static/media/carousel-arrow.15895582.svg', '轮播箭头.svg'],
  ['_next/static/media/22a5144ee8d83bca-s.p.woff2', 'Geist拉丁.woff2'],
  ['local-brand/workbench-logo.png', '工作台Logo.png'],
];
const hash = value => createHash('sha256').update(value).digest('hex');
mkdirSync(join(根目录, '界面资源/首页原样资源'), {recursive:true});
for (const [from, to] of 原样资源) {
  const dest = join(根目录, '界面资源/首页原样资源', to);
  if (existsSync(dest)) {
    if (hash(readFileSync(dest)) !== hash(readFileSync(join(old,from)))) throw Error('已有同名资源不同，拒绝覆盖');
  } else copyFileSync(join(old,from), dest, constants.COPYFILE_EXCL);
}
