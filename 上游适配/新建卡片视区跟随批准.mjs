import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

// 2026-10-18用户批准已展示的一文件差异；不覆盖历史JSON/patch或保护器。
export const 视区跟随差异SHA256 = '9577c812b3296b9f881e84c7c8b9286b1f4f21bf00e20d0a651da0bdfc55f9cb';
export const 视区跟随清单SHA256 = 'a1643ff815f8ab5b91419b46dd3656522047a520502cdafd1b86e3a3ebbac598';
const sha = value => createHash('sha256').update(value).digest('hex');
export const 视区跟随组合路径 = '画布副本/web/src/pages/canvas/project.tsx';
export function 核验视区跟随批准(json, patch) {
  if (sha(json) !== 视区跟随清单SHA256 || sha(patch) !== 视区跟随差异SHA256) throw Error('视区跟随批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 视区跟随差异SHA256 ||
    manifest.前置差异SHA256 !== '3edbd9ed415032822a5602cef465dc7b67a38f39f1cd6ed313b8c7b7989171b4' ||
    manifest.文件?.length !== 1 || manifest.文件[0].文件 !== 'web/src/pages/canvas/project.tsx') throw Error('视区跟随批准范围不符');
  return manifest;
}
export function 读取视区跟随批准() {
  return 核验视区跟随批准(readFileSync(new URL('./待审查/新建卡片视区跟随.json', import.meta.url)),
    readFileSync(new URL('./待审查/新建卡片视区跟随.patch', import.meta.url)));
}
export function 核验视区跟随自有来源(root) {
  if (SQLite安全指纹(root, '开发工具/预审新建卡片视区跟随.mjs') !== 'afb50501d16d7f3847482bc41e13994936ea9dd06d0c4e9d2a7d99ccee2113ff') throw Error('视区跟随候选生成器偏离批准来源');
}
