import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { 全局恢复历史映射 } from './全局界面恢复批准.mjs';
import { 修订前态指纹 } from './顶栏单来源批准.mjs';
import { 匹配顶栏后继 } from './首页批次后继.mjs';

// 用户单独批准精确差异。保留原待审查记录，不将其他核心修改纳入本许可。
export const 顶栏差异SHA256 = '2968209314dc8a492aeb35402a252b0fcd01a7422b9225ecf5ee75b127bc95d6';
export const 顶栏清单SHA256 = 'ffc2e09ed0ca74113303f0782aba3006682c24430d78bc0645f3f64528157f2c';
const hash = value => createHash('sha256').update(value).digest('hex');

export function 核验顶栏批准(json, patch) {
  if (hash(json) !== 顶栏清单SHA256 || hash(patch) !== 顶栏差异SHA256) throw Error('首页顶栏批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.文件.length !== 3 || manifest.差异SHA256 !== 顶栏差异SHA256) throw Error('首页顶栏批准范围不符');
  return manifest;
}

export function 读取顶栏批准() {
  return 核验顶栏批准(readFileSync(new URL('./待审查/首页顶栏原样接入.json', import.meta.url)), readFileSync(new URL('./待审查/首页顶栏原样接入.patch', import.meta.url)));
}

export function 检查顶栏批次(root, manifest) {
  const base = resolve(root);
  for (const item of manifest.文件) if (!resolve(base, item.文件).startsWith(base + sep)) throw Error('顶栏路径逃逸');
  const successor = 全局恢复历史映射(root);
  let before = 0, after = 0;
  for (const item of manifest.文件) {
    const path = resolve(root, item.文件);
    if (!path.startsWith(base + sep)) throw Error('顶栏路径逃逸');
    for (let cursor = path; cursor !== base; cursor = dirname(cursor)) {
      try { if (lstatSync(cursor).isSymbolicLink()) throw Error('顶栏不允许符号链接'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const current = 修订前态指纹(root, item.文件);
    if (current === item.候选SHA256 || 匹配顶栏后继(item, current)) after++;
    else if (successor.get(item.文件)?.原始SHA256 === item.候选SHA256 && current === successor.get(item.文件).候选SHA256) after++;
    else if (current === item.原始SHA256) before++;
    // 未接入整个功能基线时layout仍由主保护器按作者原文核验。
    else if (item.文件 === 'web/src/layouts/user-layout.tsx' && current === '642e7c9201a9da51935a4202d994185e8aff586dbbcd34cf72a8d96cd01154a3') before++;
    else throw Error('首页顶栏存在未知改动：' + item.文件);
  }
  if (before && after) throw Error('首页顶栏批次不完整，拒绝启动；请从事务快照恢复');
  return after === manifest.文件.length;
}
