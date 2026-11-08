// 2026-10-20 用户明确批准17文件隔离接入；原审查字节和历史批准器不改。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const 凭据网关任务差异SHA256 = '723841e0f57b5fb3bd21d9071b9223706833d4532ca3b3a463633e409eb1fb05';
export const 凭据网关任务清单SHA256 = '2a4f3bacbae8d9ccad5bccc5c7e32461dcb546d8a4295f28b4bef968b719d19f';
const sha = value => createHash('sha256').update(value).digest('hex');
export function 核验凭据网关任务批准(json, patch) {
  if (sha(json) !== 凭据网关任务清单SHA256 || sha(patch) !== 凭据网关任务差异SHA256) throw Error('凭据网关任务批准指纹不符');
  const manifest = JSON.parse(json);
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 凭据网关任务差异SHA256 ||
    manifest.前置差异SHA256 !== '52b00d9e890a00f1148d4ca2909e91e13bcce15ed5eddd20927c5bc96c5123e2' ||
    manifest.文件数 !== 17 || manifest.文件?.length !== 17 || new Set(manifest.文件.map(item => item.文件)).size !== 17 ||
    manifest.文件.filter(item => item.原始SHA256 === null).length !== 12 || manifest.自有来源?.length !== 10 ||
    manifest.旧版参考来源?.length !== 5 || manifest.工具来源?.length !== 1 || manifest.作者核心文件改动数 !== 0 || manifest.原画布生成已切换 !== false ||
    manifest.文件.some(item => !/^(?:画布副本\/(?:扩展功能|web\/src\/guan)|服务包\/扩展功能)\//.test(item.文件) || item.文件.split('/').includes('..'))) throw Error('凭据网关任务批准范围不符');
  return manifest;
}
export function 读取凭据网关任务批准() {
  return 核验凭据网关任务批准(readFileSync(new URL('./待审查/凭据网关与任务端口.json', import.meta.url)), readFileSync(new URL('./待审查/凭据网关与任务端口.patch', import.meta.url)));
}
export function 核验凭据网关任务来源(root) {
  const manifest = 读取凭据网关任务批准();
  for (const item of [...manifest.自有来源, ...manifest.工具来源]) {
    if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('凭据网关任务来源偏离批准：' + item.文件);
  }
  const old = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
  for (const item of manifest.旧版参考来源) if (SQLite安全指纹(old, item.文件) !== item.SHA256) throw Error('凭据网关旧版参考来源改变：' + join(old, item.文件));
  return true;
}
