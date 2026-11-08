import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

// 独立后继登记。历史审批JSON/patch及保护器保持原字节。
export const 分类容量差异SHA256 = '3edbd9ed415032822a5602cef465dc7b67a38f39f1cd6ed313b8c7b7989171b4';
export const 分类容量清单SHA256 = '3de811d743bdc7d9653f488d5df058c8da3765a4ffaf63b0d160d2652ca08550';
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = ['扩展功能/本机存储/SQLite工作区.mjs', '扩展功能/本机服务/数据服务.mjs',
  '扩展功能/本机存储/分类容量统计.mjs', '扩展功能/本机存储/分片值编码.mjs',
  'web/src/components/layout/config-local-storage.tsx', 'web/src/guan/SQLite分类容量面板.tsx'];
export function 核验分类容量批准(json, patch) {
  if (sha(json) !== 分类容量清单SHA256 || sha(patch) !== 分类容量差异SHA256) throw Error('分类容量批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 分类容量差异SHA256 ||
    manifest.文件?.length !== 6 || manifest.文件.some((item, i) => item.文件 !== paths[i])) throw Error('分类容量批准范围不符');
  return manifest;
}
export function 读取分类容量批准() {
  return 核验分类容量批准(readFileSync(new URL('./待审查/SQLite分类容量.json', import.meta.url)),
    readFileSync(new URL('./待审查/SQLite分类容量.patch', import.meta.url)));
}
export function 核验分类容量来源(root) {
  for (const item of 读取分类容量批准().自有来源)
    if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('分类容量自有来源偏离批准：' + item.文件);
  if (SQLite安全指纹(root, '开发工具/预审SQLite分类容量.mjs') !== '6b84cd78643d6c490f4b80d1c503e1226e54609c7a1673bc4c032a8437a65dee') throw Error('分类容量候选生成器偏离批准来源');
}
export const 分类容量组合路径 = path => (path.startsWith('web/') ? '画布副本/' : '服务包/') + path;
