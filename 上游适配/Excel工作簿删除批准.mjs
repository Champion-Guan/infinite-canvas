// 仅接受用户批准的工作簿整批删除原件。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const 工作簿删除差异SHA256 = '12125e114dac0c06f922052ff2e7ea222b2f8365ce8db1f4b7d324b10c7597be';
export const 工作簿删除清单SHA256 = '671eb7348c39df651aee9378f5d3af41ab54faa6011d971507508b9d26c76f1b';
const sha = value => createHash('sha256').update(value).digest('hex');
export function 核验工作簿删除批准(json, patch) {
  if (sha(json) !== 工作簿删除清单SHA256 || sha(patch) !== 工作簿删除差异SHA256) throw Error('工作簿删除批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 工作簿删除差异SHA256 ||
      manifest.前置差异SHA256 !== 'b0b146dbab238c866336a2f644821c589b79d9167225ee3b1c2af0432946be77' ||
      manifest.文件数 !== 7 || manifest.文件?.length !== 7 || new Set(manifest.文件.map(item => item.文件)).size !== 7 ||
      manifest.自有来源?.length !== 3 || manifest.工具来源?.length !== 2) throw Error('工作簿删除批准范围不符');
  return manifest;
}
export function 读取工作簿删除批准() {
  return 核验工作簿删除批准(readFileSync(new URL('./待审查/Excel工作簿删除.json', import.meta.url)),
    readFileSync(new URL('./待审查/Excel工作簿删除.patch', import.meta.url)));
}
export function 核验工作簿删除来源(root) {
  const manifest = 读取工作簿删除批准();
  for (const item of [...manifest.自有来源, ...manifest.工具来源]) {
    if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('工作簿删除来源偏离批准：' + item.文件);
  }
}
