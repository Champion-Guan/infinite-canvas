import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const 产品删除差异SHA256 = 'afed13930d9200d55060344253d1b10d89b1354b79ac371b8d3d424b52999d2b';
export const 产品删除清单SHA256 = 'c1938ef30c12536f2c87808f2744d44b088f713e15469b76c1e45fb10d232aa4';
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = [
  'web/src/guan/产品回收规则.ts', 'web/src/guan/产品回收面板.tsx',
  'web/src/stores/canvas/use-canvas-store.ts', 'web/src/stores/use-asset-store.ts',
  'web/src/guan/产品操作.ts', 'web/src/guan/顶部产品胶囊.tsx', 'web/src/guan/产品胶囊.module.css',
  'web/src/guan/旧版首页顶栏.tsx', 'web/src/guan/画布入口.tsx', 'web/src/pages/canvas/project.tsx',
];
export function 核验产品删除批准(json, patch) {
  if (sha(json) !== 产品删除清单SHA256 || sha(patch) !== 产品删除差异SHA256) throw Error('产品删除批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 产品删除差异SHA256 ||
      manifest.前置差异SHA256 !== '98cd30ccf0da6a3cf170857e5ea32e081db064d6367088a6d3082c745d8bb505' ||
      manifest.文件数 !== 10 || manifest.文件?.length !== 10 || manifest.文件.some((item, i) => item.文件 !== paths[i])) throw Error('产品删除批准范围不符');
  return manifest;
}
export function 读取产品删除批准() {
  return 核验产品删除批准(readFileSync(new URL('./待审查/产品悬浮删除十文件.json', import.meta.url)),
    readFileSync(new URL('./待审查/产品悬浮删除十文件.patch', import.meta.url)));
}
export function 核验产品删除来源(root) {
  const manifest = 读取产品删除批准();
  if (SQLite安全指纹(root, '开发工具/预审产品悬浮删除.mjs') !== '823711c54776b0d3df22020b2166018c5cd0715b7e8b0f3cf6f7093318b1f0f9') throw Error('产品删除生成器偏离批准');
  for (const [path, hash] of Object.entries(manifest.自有来源))
    if (SQLite安全指纹(root, path) !== hash) throw Error('产品删除自有来源偏离批准：' + path);
}
