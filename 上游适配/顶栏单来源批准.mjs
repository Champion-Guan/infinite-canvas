import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { 请求转发前态指纹 } from './请求转发恢复批准.mjs';

// 用户批准修订后的10文件补丁；原待审查快照保持原字节。
export const 顶栏单来源差异SHA256 = 'c20d9c494d9b08818138126cc72e9fcde55f683be95949738a385eae4ce070d8';
export const 顶栏单来源清单SHA256 = '6a2a67dd8ceceb4e96ec3c5ec8ac8a82fc056180549dcde817d5cf0ad4cd5795';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function 核验顶栏单来源批准(json, patch) {
  if (hash(json) !== 顶栏单来源清单SHA256 || hash(patch) !== 顶栏单来源差异SHA256) throw Error('顶栏单来源批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.前置恢复SHA256 !== 'd7a30ab2fee42b88be4d531caf014febc876106725c87d14159a41818bbbf4df' || manifest.差异SHA256 !== 顶栏单来源差异SHA256 || manifest.文件.length !== 10 || new Set(manifest.文件.map(item => item.文件)).size !== 10) throw Error('顶栏单来源批准范围不符');
  return manifest;
}
export function 读取顶栏单来源批准() {
  return 核验顶栏单来源批准(readFileSync(new URL('./待审查/保留顶栏主题与单测试来源.json', import.meta.url)), readFileSync(new URL('./待审查/保留顶栏主题与单测试来源.patch', import.meta.url)));
}
function 安全指纹(base, relative) {
  const path = resolve(base, relative);
  if (!path.startsWith(base + sep)) throw Error('顶栏单来源路径逃逸');
  if (lstatSync(base).isSymbolicLink()) throw Error('顶栏单来源不允许符号链接');
  for (let cursor = path; cursor !== base; cursor = dirname(cursor)) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw Error('顶栏单来源不允许符号链接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return existsSync(path) ? hash(readFileSync(path)) : null;
}
export function 检查顶栏单来源批次(root, manifest = 读取顶栏单来源批准()) {
  const base = resolve(root);
  let before = 0, after = 0, uniqueAfter = false;
  const anchors = new Set(['web/src/services/api/prompt-source-presets.ts', 'web/src/services/config-file.ts', 'web/src/guan/脚本与提示词来源.ts']);
  for (const item of manifest.文件) {
    const current = 请求转发前态指纹(base, item.文件);
    if (current === item.原始SHA256) before++;
    if (current === item.候选SHA256) { after++; if (anchors.has(item.文件)) uniqueAfter = true; }
  }
  if (after === 10) return true;
  if (before === 10) return false;
  const restored = 安全指纹(base, 'web/src/guan/精简与离线策略.ts') === '4a6025946df2a6436d6ebb966c1ce33c7ee4bebf111a0e16956ec64f1c43fa12';
  if (restored || uniqueAfter) throw Error('顶栏单来源批次不完整或存在未知改动，拒绝启动；请从事务快照恢复');
  return false; // 更早状态仍由各历史批准器逐文件核验。
}
export function 顶栏单来源历史映射(root) {
  const manifest = 读取顶栏单来源批准();
  return 检查顶栏单来源批次(root, manifest) ? new Map(manifest.文件.map(item => [item.文件, item])) : new Map();
}
// 只有整10文件精确后态通过才映射回批准前态，绝非路径豁免。
export function 修订前态指纹(root, relative) {
  return 顶栏单来源历史映射(root).get(relative)?.原始SHA256 ?? 安全指纹(resolve(root), relative);
}
