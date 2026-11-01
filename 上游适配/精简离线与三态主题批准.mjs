import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { 合并恢复历史映射 } from './音视频提示词与节点信息恢复批准.mjs';
import { 修订前态指纹 } from './顶栏单来源批准.mjs';

// 2026-10-16 用户批准“精简离线与三态主题21文件补丁”；历史审查快照不覆盖。
export const 精简主题差异SHA256 = '14d9d721685d0930ad929f732e8aa6dcf4da27dcff62cbf5a060d6b9d095cca0';
export const 精简主题清单SHA256 = 'dd2411d92dc8dd389b354e53c7836ff14f1f5f2d96fb960e80aba315c7668ae4';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function 核验精简主题批准(json, patch) {
  if (hash(json) !== 精简主题清单SHA256 || hash(patch) !== 精简主题差异SHA256) throw Error('精简主题批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.前置全局恢复SHA256 !== '7702ebc0e140025f7f176b032137088d0684b8c63cf360e36900c2a898ac69e5' || manifest.差异SHA256 !== 精简主题差异SHA256 || manifest.文件.length !== 21 || new Set(manifest.文件.map(item => item.文件)).size !== 21) throw Error('精简主题批准范围不符');
  return manifest;
}

export function 读取精简主题批准() {
  return 核验精简主题批准(readFileSync(new URL('./待审查/精简离线与三态主题.json', import.meta.url)), readFileSync(new URL('./待审查/精简离线与三态主题.patch', import.meta.url)));
}

export function 检查精简主题批次(root, manifest = 读取精简主题批准()) {
  const base = resolve(root);
  if (lstatSync(base).isSymbolicLink()) throw Error('精简主题不允许符号链接');
  let after = 0;
  const currents = new Map();
  for (const item of manifest.文件) {
    const path = resolve(base, item.文件);
    if (!path.startsWith(base + sep)) throw Error('精简主题路径逃逸');
    for (let cursor = path; cursor !== base; cursor = dirname(cursor)) {
      try { if (lstatSync(cursor).isSymbolicLink()) throw Error('精简主题不允许符号链接'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const current = 修订前态指纹(root, item.文件);
    currents.set(item.文件, current);
  }
  const successor = 合并恢复历史映射(root);
  for (const item of manifest.文件) {
    const next = successor.get(item.文件);
    if (next && next.原始SHA256 !== item.候选SHA256) throw Error('合并恢复前置链不符');
    const current = next ? next.原始SHA256 : currents.get(item.文件);
    if (current === item.候选SHA256) after++;
    else if (item.原始SHA256 === null && current !== null) throw Error('精简主题自有模块存在未知改动');
  }
  // 零份新产物时交给历史逐层校验；不能将部分新批次当成历史状态。
  if (after && after !== manifest.文件.length) throw Error('精简主题批次不完整，拒绝启动；请从事务快照恢复');
  return after === manifest.文件.length;
}

export function 精简主题历史映射(root) {
  const manifest = 读取精简主题批准();
  if (!检查精简主题批次(root, manifest)) return new Map();
  const successor = 合并恢复历史映射(root);
  return new Map(manifest.文件.map(item => [item.文件, successor.has(item.文件) ? { ...item, 候选SHA256: successor.get(item.文件).候选SHA256 } : item]));
}
