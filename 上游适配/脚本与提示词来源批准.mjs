import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { 全局恢复历史映射 } from './全局界面恢复批准.mjs';
import { 修订前态指纹 } from './顶栏单来源批准.mjs';

// 2026-10-16用户明确批准三项关闭补丁。审查快照保持不变，批准在本模块登记。
export const 脚本来源差异SHA256 = 'b615e837c229023f3f021601fa506ad8bcaaae8886cd4631bea3dad97f29f2ec';
export const 脚本来源清单SHA256 = 'aabd8ed89a0957ee7ea71367d4a9227ce3e64f8b0b2703a764474a537ef30711';
const hash = value => createHash('sha256').update(value).digest('hex');
const paths = [
  'web/src/components/layout/channel-editor-drawer.tsx',
  'web/src/stores/use-config-store.ts',
  'web/src/services/api/model-plugin.ts',
  'web/src/components/layout/app-config-modal.tsx',
  'web/src/hooks/use-prompt-source-scheduler.ts',
  'web/src/services/api/prompts.ts',
  'web/src/services/api/prompt-source-runtime.ts',
  'web/src/stores/use-prompt-source-store.ts',
  'web/src/guan/脚本与提示词来源.ts',
];
const authorBefore = {
  'web/src/stores/use-config-store.ts': '9d519ec444fa816051d24c762e7c4b5d78b35bab2f9b2ab61702a94bef0d4b5b',
  'web/src/components/layout/app-config-modal.tsx': '0378a605ba953805eb0d4e968290e1bb401b671f8ae8c8efd4abff8919bd59d3',
};

export function 核验脚本来源批准(json, patch) {
  if (hash(json) !== 脚本来源清单SHA256 || hash(patch) !== 脚本来源差异SHA256) throw Error('脚本来源批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.差异SHA256 !== 脚本来源差异SHA256 || manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.前置双入口差异SHA256 !== '84ce03a198345769f2314e0e7dc220b1030a7f9d93152ff410125036afc425ef' || JSON.stringify(manifest.关闭编号) !== JSON.stringify(['S03', 'R02', 'R03']) || JSON.stringify(manifest.文件.map(item => item.文件)) !== JSON.stringify(paths)) throw Error('脚本来源批准范围不符');
  return manifest;
}

export function 读取脚本来源批准() {
  return 核验脚本来源批准(readFileSync(new URL('./待审查/脚本与提示词来源关闭.json', import.meta.url)), readFileSync(new URL('./待审查/脚本与提示词来源关闭.patch', import.meta.url)));
}

export function 检查脚本来源批次(root, manifest) {
  const base = resolve(root);
  if (lstatSync(base).isSymbolicLink()) throw Error('脚本来源不允许符号链接');
  for (const item of manifest.文件) if (!resolve(base, item.文件).startsWith(base + sep)) throw Error('脚本来源路径逃逸');
  const successor = 全局恢复历史映射(root);
  let before = 0, after = 0;
  for (const item of manifest.文件) {
    const path = resolve(base, item.文件);
    if (!path.startsWith(base + sep)) throw Error('脚本来源路径逃逸');
    for (let cursor = path; cursor !== base; cursor = dirname(cursor)) {
      try { if (lstatSync(cursor).isSymbolicLink()) throw Error('脚本来源不允许符号链接'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const current = 修订前态指纹(root, item.文件);
    if (current === item.候选SHA256) after++;
    else if (successor.get(item.文件)?.原始SHA256 === item.候选SHA256 && current === successor.get(item.文件).候选SHA256) after++;
    else if (current === item.原始SHA256 || (authorBefore[item.文件] && current === authorBefore[item.文件])) before++;
    else throw Error('脚本来源存在未知改动：' + item.文件);
  }
  if (before && after) throw Error('脚本来源批次不完整，拒绝启动；请从事务快照恢复');
  return after === manifest.文件.length;
}
