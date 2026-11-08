import { constants, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 品牌资源 } from '../上游适配/全局顶栏主题品牌恢复.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

export function 读取品牌资源() {
  const target = join(根目录, 品牌资源.自有来源);
  const bytes = readFileSync(existsSync(target) ? target : 品牌资源.旧来源);
  if (hash(bytes) !== 品牌资源.SHA256) throw Error('紫色G原资源指纹不符，拒绝使用或覆盖');
  return bytes;
}

export function 导入品牌资源() {
  const bytes = readFileSync(品牌资源.旧来源);
  if (hash(bytes) !== 品牌资源.SHA256) throw Error('旧图标发生变化，须重新审查');
  const target = join(根目录, 品牌资源.自有来源);
  if (existsSync(target)) {
    if (!readFileSync(target).equals(bytes)) throw Error('自有图标有不同内容，拒绝覆盖');
  } else {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(品牌资源.旧来源, target, constants.COPYFILE_EXCL);
  }
  return target;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) console.log(导入品牌资源());
