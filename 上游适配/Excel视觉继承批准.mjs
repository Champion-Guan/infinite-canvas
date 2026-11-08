import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const Excel视觉继承差异SHA256 = '1f6b1e87ec8e48dc6cd46141fec6d2cdcf93029022920bf973e0461c6f239d46';
export const Excel视觉继承清单SHA256 = '32f9149cf7d2332ca6f3203b17c0e4e2f5a531e90e3d14c0450daffaee6fbbed';
const sha = value => createHash('sha256').update(value).digest('hex');
export function 核验Excel视觉继承批准(json, patch) {
  if (sha(json) !== Excel视觉继承清单SHA256 || sha(patch) !== Excel视觉继承差异SHA256) throw Error('Excel视觉继承批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== Excel视觉继承差异SHA256 ||
      manifest.前置差异SHA256 !== '66224fee6704cff7f08daccaa5af3f2482df9c54e76e30ec2187ac4b8908d822' ||
      manifest.文件数 !== 1 || manifest.文件?.length !== 1 || manifest.文件[0].文件 !== 'web/src/guan/旧版Excel样式.css' ||
      manifest.自有来源 !== '扩展功能/Excel/Excel弹窗行高边界.css') throw Error('Excel视觉继承批准范围不符');
  return manifest;
}
export function 读取Excel视觉继承批准() {
  return 核验Excel视觉继承批准(readFileSync(new URL('./待审查/Excel弹窗视觉继承一文件.json', import.meta.url)),
    readFileSync(new URL('./待审查/Excel弹窗视觉继承一文件.patch', import.meta.url)));
}
export function 核验Excel视觉继承来源(root) {
  const manifest = 读取Excel视觉继承批准();
  for (const [path, hash] of [[manifest.生成器, manifest.生成器SHA256], [manifest.自有来源, manifest.来源SHA256]]) {
    if (SQLite安全指纹(root, path) !== hash) throw Error('Excel视觉继承来源偏离批准：' + path);
  }
}
