import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const Excel差异SHA256 = '95b4023354582786d93a4e37e8ce0dbe7350da2d82539582135a03f13933dd0d';
export const Excel清单SHA256 = '29b430fd3cee3e650cb3c1849fa60985dfe0ef18af31819d36a000c13c70ca4c';
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = ['Excel产品归属.ts', 'Excel文件读取.ts', 'Excel保存导航.ts', 'Excel导入面板.tsx', 'Excel工作簿选择.tsx',
  '旧版Excel解析.js', '旧版Excel合同.js', '旧版Excel弹窗.js', '旧版Excel样式.css'].map(path => 'web/src/guan/' + path).concat([
  'web/public/guan/Excel/xlsx.full.min.js', 'web/public/guan/Excel/SheetJS-LICENSE.txt',
  'web/src/stores/canvas/use-canvas-store.ts', 'web/src/guan/旧版首页顶栏.tsx', 'web/src/guan/顶部产品胶囊.tsx', 'web/src/guan/画布入口.tsx', 'web/src/guan/产品操作.ts']);
export function 核验Excel批准(json, patch) {
  if (sha(json) !== Excel清单SHA256 || sha(patch) !== Excel差异SHA256) throw Error('Excel批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== Excel差异SHA256 ||
      manifest.前置差异SHA256 !== '732fa40e8537921c54919bbdf0b70f67081f44bcc5dc4547379ecea8563a49e3' ||
      manifest.文件数 !== 16 || manifest.文件?.length !== 16 || manifest.文件.some((item, i) => item.文件 !== paths[i])) throw Error('Excel批准范围不符');
  return manifest;
}
export function 读取Excel批准() {
  return 核验Excel批准(readFileSync(new URL('./待审查/Excel导入与工作簿迁入.json', import.meta.url)),
    readFileSync(new URL('./待审查/Excel导入与工作簿迁入.patch', import.meta.url)));
}
export function 核验Excel来源(root) {
  const manifest = 读取Excel批准();
  const sources = [...manifest.自有来源, { 文件: '开发工具/预审Excel迁入.mjs', SHA256: 'd3bb59416a0ae1750b85881b69a1660c1ca2de4308f62f8831bd70731da3bc12' }];
  for (const item of sources) if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('Excel来源偏离批准：' + item.文件);
  for (const [path, hash] of Object.entries(manifest.旧来源SHA256))
    if (SQLite安全指纹(manifest.旧来源目录, path) !== hash) throw Error('Excel旧来源偏离批准：' + path);
}
