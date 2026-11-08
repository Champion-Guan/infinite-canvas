import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const SQLite会话恢复差异SHA256 = '66224fee6704cff7f08daccaa5af3f2482df9c54e76e30ec2187ac4b8908d822';
export const SQLite会话恢复清单SHA256 = 'd553b6410cc29ba4de3c017d0bd901a3f1c135f555d2e446dd0f330961ec0e7b';
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = Object.freeze([
  '扩展功能/本机服务/受控会话.mjs', '扩展功能/本机服务/本机授权网关.mjs',
  'web/src/guan/sqlite/本机授权客户端.mjs', 'web/src/guan/sqlite/续期数据客户端.mjs',
  'web/src/guan/sqlite/工作台自动入口.mjs', 'web/src/guan/上游浏览器存储桥.ts', 'web/src/guan/保存状态条.tsx',
]);
export function 核验SQLite会话恢复批准(json, patch) {
  if (sha(json) !== SQLite会话恢复清单SHA256 || sha(patch) !== SQLite会话恢复差异SHA256) throw Error('SQLite会话恢复批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== SQLite会话恢复差异SHA256 ||
      manifest.前置差异SHA256 !== '5d88e270b61cf32d8d8583f027c5cca7a175965753ec7f6250b22577788ea714' ||
      manifest.文件数 !== 7 || manifest.文件?.length !== 7 || manifest.自有来源?.length !== 7 ||
      paths.some((path, i) => manifest.文件[i].文件 !== path || manifest.自有来源[i].文件 !== path)) throw Error('SQLite会话恢复批准范围不符');
  return manifest;
}
export function 读取SQLite会话恢复批准() {
  return 核验SQLite会话恢复批准(readFileSync(new URL('./待审查/SQLite会话恢复七文件.json', import.meta.url)),
    readFileSync(new URL('./待审查/SQLite会话恢复七文件.patch', import.meta.url)));
}
export function 核验SQLite会话恢复来源(root) {
  const manifest = 读取SQLite会话恢复批准();
  for (const [path, hash] of [
    ['开发工具/预审SQLite会话恢复.mjs', '065894506ed3c825748cd52bc347a2e40f77be9991d4a050ffb040949cfa0bcb'],
    ...manifest.自有来源.map(item => [item.来源, item.SHA256]),
  ]) if (SQLite安全指纹(root, path) !== hash) throw Error('SQLite会话恢复来源偏离批准：' + path);
}
