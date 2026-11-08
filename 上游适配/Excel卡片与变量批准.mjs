import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const Excel卡片差异SHA256 = 'b0b146dbab238c866336a2f644821c589b79d9167225ee3b1c2af0432946be77';
export const Excel卡片清单SHA256 = 'c20790b95d0c9b7aac3b6a1ca0c233e58a7c60773927f1c6033377b757af3c64';
const sha = value => createHash('sha256').update(value).digest('hex');
export function 核验Excel卡片批准(json, patch) {
  if (sha(json) !== Excel卡片清单SHA256 || sha(patch) !== Excel卡片差异SHA256) throw Error('Excel卡片批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== Excel卡片差异SHA256 ||
      manifest.前置差异SHA256 !== '1f6b1e87ec8e48dc6cd46141fec6d2cdcf93029022920bf973e0461c6f239d46' ||
      manifest.文件数 !== 17 || manifest.文件?.length !== 17 || new Set(manifest.文件.map(item => item.文件)).size !== 17 ||
      manifest.自有来源?.length !== 6 || manifest.工具来源?.length !== 2) throw Error('Excel卡片批准范围不符');
  return manifest;
}
export function 读取Excel卡片批准() {
  return 核验Excel卡片批准(readFileSync(new URL('./待审查/Excel卡片与变量迁入.json', import.meta.url)),
    readFileSync(new URL('./待审查/Excel卡片与变量迁入.patch', import.meta.url)));
}
export function 核验Excel卡片来源(root) {
  const manifest = 读取Excel卡片批准();
  for (const item of [...manifest.自有来源, ...manifest.工具来源]) {
    if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('Excel卡片来源偏离批准：' + item.文件);
  }
}
