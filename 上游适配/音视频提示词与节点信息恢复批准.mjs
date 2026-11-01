import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { 修订前态指纹 } from './顶栏单来源批准.mjs';

// 2026-10-16 用户明确批准10文件恢复补丁；保留原审查JSON/patch，不覆盖历史。
export const 合并恢复差异SHA256 = 'd7a30ab2fee42b88be4d531caf014febc876106725c87d14159a41818bbbf4df';
export const 合并恢复清单SHA256 = 'c13657f6fa8c2cea3aa6925879530c2923765c13fd21828517d71ed17fceec1f';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function 核验合并恢复批准(json, patch) {
  if (hash(json) !== 合并恢复清单SHA256 || hash(patch) !== 合并恢复差异SHA256) throw Error('合并恢复批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.前置精简SHA256 !== '14d9d721685d0930ad929f732e8aa6dcf4da27dcff62cbf5a060d6b9d095cca0' || manifest.差异SHA256 !== 合并恢复差异SHA256 || manifest.文件.length !== 10 || new Set(manifest.文件.map(item => item.文件)).size !== 10) throw Error('合并恢复批准范围不符');
  return manifest;
}

export function 读取合并恢复批准() {
  return 核验合并恢复批准(readFileSync(new URL('./待审查/音视频提示词与节点信息恢复.json', import.meta.url)), readFileSync(new URL('./待审查/音视频提示词与节点信息恢复.patch', import.meta.url)));
}

export function 检查合并恢复批次(root, manifest = 读取合并恢复批准()) {
  const base = resolve(root);
  if (lstatSync(base).isSymbolicLink()) throw Error('合并恢复不允许符号链接');
  let before = 0, after = 0, policyExists = false, uniqueAfter = false;
  // 五个提示词产物恰与更早历史相同，不能误把它们当成新批次已经应用。
  const anchors = new Set(['web/src/guan/精简与离线策略.ts', 'web/src/components/layout/app-config-modal.tsx', 'web/src/components/canvas/canvas-node-hover-toolbar.tsx', 'web/src/pages/canvas/project.tsx']);
  for (const item of manifest.文件) {
    const path = resolve(base, item.文件);
    if (!path.startsWith(base + sep)) throw Error('合并恢复路径逃逸');
    for (let cursor = path; cursor !== base; cursor = dirname(cursor)) {
      try { if (lstatSync(cursor).isSymbolicLink()) throw Error('合并恢复不允许符号链接'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const current = 修订前态指纹(root, item.文件);
    if (item.文件 === 'web/src/guan/精简与离线策略.ts' && current !== null) policyExists = true;
    if (current === item.原始SHA256) before++;
    if (current === item.候选SHA256) { after++; if (anchors.has(item.文件)) uniqueAfter = true; }
  }
  if (after === manifest.文件.length) return true;
  if (before === manifest.文件.length) return false;
  // 策略文件在21文件批次才出现；出现后只允许完整前态或完整后态。
  // 更早历史由旧保护器继续核验，不接受新批次的独有产物混入。
  if (policyExists || uniqueAfter || (before && after)) throw Error('合并恢复批次不完整或存在未知改动，拒绝启动；请从事务快照恢复');
  return false;
}

export function 合并恢复历史映射(root) {
  const manifest = 读取合并恢复批准();
  return 检查合并恢复批次(root, manifest) ? new Map(manifest.文件.map(item => [item.文件, item])) : new Map();
}
