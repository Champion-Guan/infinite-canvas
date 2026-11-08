import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const Excel勾选差异SHA256 = '5d88e270b61cf32d8d8583f027c5cca7a175965753ec7f6250b22577788ea714';
export const Excel勾选清单SHA256 = '3daea8836dd38eea0c0371587da3d2ec270f4677d653c524cf948a3ab01f048c';
const sha = value => createHash('sha256').update(value).digest('hex');
export function 核验Excel勾选批准(json, patch) {
  if (sha(json) !== Excel勾选清单SHA256 || sha(patch) !== Excel勾选差异SHA256) throw Error('Excel勾选批准指纹不符');
  const m = JSON.parse(json), file = m.文件?.[0];
  if (m.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || m.差异SHA256 !== Excel勾选差异SHA256 ||
      m.前置差异SHA256 !== '95b4023354582786d93a4e37e8ce0dbe7350da2d82539582135a03f13933dd0d' ||
      m.文件数 !== 1 || m.文件?.length !== 1 || file.文件 !== 'web/src/guan/Excel导入面板.tsx' ||
      file.原始SHA256 !== 'f84e6e2b10a300923191acdfec9291ac8c0aa7cae61f4076c40f52415c1c161d' ||
      file.候选SHA256 !== 'b305988c7e22b877837fcc0d3fc9142adcdfcd7fc4803f459aafadc127a130a2') throw Error('Excel勾选批准范围不符');
  return m;
}
export function 读取Excel勾选批准() {
  return 核验Excel勾选批准(readFileSync(new URL('./待审查/Excel勾选事件一文件修订.json', import.meta.url)),
    readFileSync(new URL('./待审查/Excel勾选事件一文件修订.patch', import.meta.url)));
}
export function 核验Excel勾选来源(root) {
  读取Excel勾选批准();
  for (const [path, hash] of Object.entries({
    '开发工具/预审Excel勾选事件.mjs': '3aaf855534995ccf04717a9f8e2a3ab587a236db3e83e0901fff5e349b88addf',
    '扩展功能/Excel/Excel导入面板.tsx': 'f84e6e2b10a300923191acdfec9291ac8c0aa7cae61f4076c40f52415c1c161d',
  })) if (SQLite安全指纹(root, path) !== hash) throw Error('Excel勾选来源偏离批准：' + path);
}
