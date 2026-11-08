// 只接受本轮明确批准的一文件视觉后继；历史原件保持。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const Excel删除视觉继承差异SHA256 = '9d143e96b439a9425035ca347644e8b6ed11c4b019a3963dfd9da45eb1d1d0f9';
export const Excel删除视觉继承清单SHA256 = '65685bba802752f343a900e7611791edec7706b8a2efcbffe2874d23cdeb9ac2';
const sha = value => createHash('sha256').update(value).digest('hex');
export function 核验Excel删除视觉继承批准(json, patch) {
  if (sha(json) !== Excel删除视觉继承清单SHA256 || sha(patch) !== Excel删除视觉继承差异SHA256) throw Error('删除视觉批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' ||
      manifest.差异SHA256 !== Excel删除视觉继承差异SHA256 ||
      manifest.前置差异SHA256 !== '12125e114dac0c06f922052ff2e7ea222b2f8365ce8db1f4b7d324b10c7597be' ||
      manifest.文件数 !== 1 || manifest.文件?.length !== 1 ||
      manifest.文件[0].文件 !== 'web/src/guan/工作簿删除弹窗.tsx' ||
      manifest.自有来源?.length !== 1 || manifest.工具来源?.length !== 2) throw Error('删除视觉批准范围不符');
  return manifest;
}
export function 读取Excel删除视觉继承批准() {
  return 核验Excel删除视觉继承批准(readFileSync(new URL('./待审查/Excel删除视觉继承一文件.json', import.meta.url)),
    readFileSync(new URL('./待审查/Excel删除视觉继承一文件.patch', import.meta.url)));
}
export function 核验Excel删除视觉继承来源(root) {
  const manifest = 读取Excel删除视觉继承批准();
  for (const item of [...manifest.自有来源, ...manifest.工具来源]) {
    if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('删除视觉来源偏离批准：' + item.文件);
  }
}
