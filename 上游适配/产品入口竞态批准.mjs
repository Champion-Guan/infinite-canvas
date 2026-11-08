import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const 产品入口差异SHA256 = '98cd30ccf0da6a3cf170857e5ea32e081db064d6367088a6d3082c745d8bb505';
export const 产品入口清单SHA256 = '7893cfdd2a4c3930ac4669e64a85ce7213e511d5258b091af7e7c308e08df689';
export const 产品入口组合路径 = '画布副本/web/src/guan/画布入口.tsx';
const sha = value => createHash('sha256').update(value).digest('hex');
export function 核验产品入口批准(json, patch) {
  if (sha(json) !== 产品入口清单SHA256 || sha(patch) !== 产品入口差异SHA256) throw Error('产品入口批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 产品入口差异SHA256 ||
      manifest.前置差异SHA256 !== '4143370262ebf7425c4bc59e1b980ee80ad843ccd8bbf5b144c0a4e7896f170a' ||
      manifest.文件?.length !== 1 || manifest.文件[0].文件 !== 'web/src/guan/画布入口.tsx') throw Error('产品入口批准范围不符');
  return manifest;
}
export function 读取产品入口批准() {
  return 核验产品入口批准(readFileSync(new URL('./待审查/产品入口创建竞态.json', import.meta.url)),
    readFileSync(new URL('./待审查/产品入口创建竞态.patch', import.meta.url)));
}
export function 核验产品入口来源(root) {
  if (SQLite安全指纹(root, '开发工具/预审产品入口创建竞态.mjs') !== 'a9341caccdc959d80030303ad115d8412ff8d4dc7a0d6c1c77d12e4552372443') throw Error('产品入口来源偏离批准');
}
