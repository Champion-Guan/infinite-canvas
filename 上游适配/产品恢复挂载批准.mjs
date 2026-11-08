import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const 恢复挂载差异SHA256 = '732fa40e8537921c54919bbdf0b70f67081f44bcc5dc4547379ecea8563a49e3';
export const 恢复挂载清单SHA256 = 'f573933446af519620c2b75255d7c01debf9ce775a4fce42c36b7488abe3a00e';
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = ['web/src/guan/产品恢复挂载门禁.ts', 'web/src/guan/产品操作.ts', 'web/src/guan/产品工作区.tsx'];

export function 核验恢复挂载批准(json, patch) {
  if (sha(json) !== 恢复挂载清单SHA256 || sha(patch) !== 恢复挂载差异SHA256) throw Error('恢复挂载复审批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 恢复挂载差异SHA256 ||
      manifest.前置差异SHA256 !== 'afed13930d9200d55060344253d1b10d89b1354b79ac371b8d3d424b52999d2b' ||
      manifest.文件数 !== 3 || manifest.文件?.length !== 3 || manifest.文件.some((item, i) => item.文件 !== paths[i]))
    throw Error('恢复挂载复审批准范围不符');
  return manifest;
}
export function 读取恢复挂载批准() {
  return 核验恢复挂载批准(readFileSync(new URL('./待审查/产品恢复挂载竞态三文件复审.json', import.meta.url)),
    readFileSync(new URL('./待审查/产品恢复挂载竞态三文件复审.patch', import.meta.url)));
}
export function 核验恢复挂载来源(root) {
  const manifest = 读取恢复挂载批准();
  for (const [path, hash] of Object.entries({ ...manifest.生成器, ...manifest.自有来源 }))
    if (SQLite安全指纹(root, path) !== hash) throw Error('恢复挂载复审来源偏离批准：' + path);
}
