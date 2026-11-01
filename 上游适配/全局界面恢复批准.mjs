import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { 精简主题历史映射 } from './精简离线与三态主题批准.mjs';
import { 修订前态指纹 } from './顶栏单来源批准.mjs';

// 2026-10-16用户明确批准具体9文件恢复差异。待审查快照作为历史证据不覆盖。
export const 全局恢复差异SHA256 = '7702ebc0e140025f7f176b032137088d0684b8c63cf360e36900c2a898ac69e5';
export const 全局恢复清单SHA256 = '1d00fc64deffe5645dfabe8bc5dfe9a450bc8de5cbe16c68b1e1d2a8158ca475';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = [
  'web/src/layouts/user-layout.tsx', 'web/src/guan/旧版首页顶栏.tsx',
  'web/src/guan/功能开关.ts', 'web/src/guan/脚本与提示词来源.ts',
  'web/src/components/layout/app-providers.tsx', 'web/index.html',
  'web/src/router.tsx', 'web/src/pages/not-found/index.tsx',
  'web/public/guan/brand/favicon.png',
];

export function 核验全局恢复批准(json, patch) {
  if (hash(json) !== 全局恢复清单SHA256 || hash(patch) !== 全局恢复差异SHA256) throw Error('全局恢复批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 全局恢复差异SHA256 || JSON.stringify(manifest.恢复编号) !== JSON.stringify(['U02', 'R02', 'R03']) || JSON.stringify(manifest.保持关闭) !== JSON.stringify(['S03']) || JSON.stringify(manifest.文件.map(item => item.文件)) !== JSON.stringify(paths)) throw Error('全局恢复批准范围不符');
  return manifest;
}

export function 读取全局恢复批准() {
  return 核验全局恢复批准(readFileSync(new URL('./待审查/全局顶栏主题品牌恢复.json', import.meta.url)), readFileSync(new URL('./待审查/全局顶栏主题品牌恢复.patch', import.meta.url)));
}

export function 检查全局恢复批次(root, manifest = 读取全局恢复批准()) {
  const base = resolve(root);
  if (lstatSync(base).isSymbolicLink()) throw Error('全局恢复不允许符号链接');
  for (const item of manifest.文件) if (!resolve(base, item.文件).startsWith(base + sep)) throw Error('全局恢复路径逃逸');
  const successor = 精简主题历史映射(root);
  let after = 0;
  for (const item of manifest.文件) {
    const path = resolve(base, item.文件);
    if (!path.startsWith(base + sep)) throw Error('全局恢复路径逃逸');
    for (let cursor = path; cursor !== base; cursor = dirname(cursor)) {
      try { if (lstatSync(cursor).isSymbolicLink()) throw Error('全局恢复不允许符号链接'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const current = 修订前态指纹(root, item.文件);
    if (current === item.候选SHA256) after++;
    else if (successor.get(item.文件)?.原始SHA256 === item.候选SHA256 && current === successor.get(item.文件).候选SHA256) after++;
    else if (item.原始SHA256 === null && current !== null) throw Error('品牌资源存在未知改动');
  }
  const assets = resolve(base, 'web/public/guan/brand');
  if (existsSync(assets)) for (const entry of readdirSync(assets, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name !== 'favicon.png') throw Error('品牌资源包含未声明文件');
  }
  // 零个新产物时，历史前态由原有逐层保护器继续严格验证，不放宽它们。
  if (after && after !== manifest.文件.length) throw Error('全局恢复批次不完整，拒绝启动；请从事务快照恢复');
  return after === manifest.文件.length;
}

// 仅在完整9文件后态通过时，允许旧批次识别它的精确后继，不接受单文件混搭。
export function 全局恢复历史映射(root) {
  const manifest = 读取全局恢复批准();
  if (!检查全局恢复批次(root, manifest)) return new Map();
  const next = 精简主题历史映射(root);
  const map = new Map(manifest.文件.map(item => [item.文件, item]));
  for (const [path, item] of next) {
    const old = map.get(path);
    if (old && old.候选SHA256 !== item.原始SHA256) throw Error('精简主题历史链不符');
    map.set(path, old ? { ...old, 候选SHA256: item.候选SHA256 } : item);
  }
  return map;
}
