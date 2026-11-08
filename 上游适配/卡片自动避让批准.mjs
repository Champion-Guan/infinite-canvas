import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

// 2026-10-18 用户明确批准四文件隔离接入及真实浏览器验收。
// 审查JSON/patch是批准前的历史快照，保留原字节；不授权3100切换或重启。
export const 卡片布局差异SHA256 = 'dcf620c3d050f42a76aa4148b30d5290cc92dbb8df1069a2c907fa26748f6cf8';
export const 卡片布局清单SHA256 = 'bd8dd408912035c98209dd7c7178d014ce71b70ec10cc673613cec339a2decf2';
export const 卡片布局文件 = Object.freeze([
  ['web/src/pages/canvas/project.tsx', 'fe73c19869458069c14b4e0bf86134f82c9e789879b8d64225bc8bd0b78fb331', 'efb8f275f3610d21fca95923b022c4446e5642281a05f5daf78fb4479f07732c'],
  ['web/src/components/canvas/canvas-top-bar.tsx', '4251a6db892bbc51942b01610c8b7babfe3e0da666d9239ae2562043e5512143', 'abd33135ee9b85d4f5b6a2d2668a8e42f7233a9d474b004238c1ef7dee24981c'],
  ['web/src/types/canvas.ts', 'e158ad88d9fa13d5514e990c88a987700c111247dc0541d6dab8a90321ada956', '8dd830028b91d79ce942476bc6473143dadf2ae850641abd453d520aef7135de'],
  ['web/src/guan/卡片自动避让.ts', null, '9e95193590ca10d83866d36e645c9d1324785fe27fce9286dcb39dc3b8779889'],
].map(item => Object.freeze(item)));
const sha = value => createHash('sha256').update(value).digest('hex');
export function 核验卡片布局批准(json, patch) {
  if (sha(json) !== 卡片布局清单SHA256 || sha(patch) !== 卡片布局差异SHA256) throw Error('卡片布局批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' ||
    manifest.前置日常启动差异SHA256 !== 'c5542c35527de84e4ef1222631aadd30d5cb8fc5e8ecf89c13d5c4fb615d363a' ||
    manifest.差异SHA256 !== 卡片布局差异SHA256 || manifest.文件?.length !== 4 ||
    manifest.文件.some((item, i) => item.文件 !== 卡片布局文件[i][0] ||
      item.原始SHA256 !== 卡片布局文件[i][1] || item.候选SHA256 !== 卡片布局文件[i][2])) throw Error('卡片布局批准范围或前置不符');
  return manifest;
}
export function 读取卡片布局批准() {
  return 核验卡片布局批准(readFileSync(new URL('./待审查/卡片自动避让原样迁入.json', import.meta.url)),
    readFileSync(new URL('./待审查/卡片自动避让原样迁入.patch', import.meta.url)));
}
export function 核验卡片布局自有来源(root) {
  for (const [path, hash] of [
    ['扩展功能/画布布局/卡片自动避让.ts', 卡片布局文件[3][2]],
    ['开发工具/预审卡片自动避让.mjs', '09928ff1212b9ae3799d9e5353a6bc1f3b8afe403d058ccd5956fb77b6998f0b'],
  ]) if (SQLite安全指纹(root, path) !== hash) throw Error('卡片布局自有来源偏离批准：' + path);
}
