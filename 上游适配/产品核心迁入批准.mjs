import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

// 仅登记用户本轮批准，历史候选JSON/patch保持原字节。
export const 产品差异SHA256 = '4143370262ebf7425c4bc59e1b980ee80ad843ccd8bbf5b144c0a4e7896f170a';
export const 产品清单SHA256 = '56a7be66702a3e393443d5df0f1aa25bdd38da3b3f4f95406da12596806bca8e';
const sha = value => createHash('sha256').update(value).digest('hex');
export function 核验产品批准(json, patch) {
  if (sha(json) !== 产品清单SHA256 || sha(patch) !== 产品差异SHA256) throw Error('产品批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 产品差异SHA256 ||
      manifest.前置差异SHA256 !== '9577c812b3296b9f881e84c7c8b9286b1f4f21bf00e20d0a651da0bdfc55f9cb' ||
      manifest.文件?.length !== 30 || new Set(manifest.文件.map(item => item.文件)).size !== 30 ||
      manifest.文件.filter(item => item.原始SHA256 === null).length !== 10 ||
      manifest.文件.some(item => !/^web\/src\//.test(item.文件) || item.文件.includes('..'))) throw Error('产品批准范围不符');
  return manifest;
}
export function 读取产品批准() {
  return 核验产品批准(readFileSync(new URL('./待审查/产品核心迁入.json', import.meta.url)),
    readFileSync(new URL('./待审查/产品核心迁入.patch', import.meta.url)));
}
export function 核验产品自有来源(root) {
  const manifest = 读取产品批准();
  if (SQLite安全指纹(root, '开发工具/预审产品核心迁入.mjs') !== '5019136399cf3d358c06363145050862ac1f90dacc962d7a5c0a6127346151b9') throw Error('产品候选生成器偏离批准');
  for (const item of manifest.自有来源) {
    if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('产品自有来源偏离批准：' + item.文件);
  }
}
