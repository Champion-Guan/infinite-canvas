// 用户批准冻结的67文件整批；不修改任何历史审批及来源。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const 迁移扩大整批差异SHA256 = '009444d584648f349318edd6edd06e59edab70d98e13c89647ce920a2be3958e';
export const 迁移扩大整批清单SHA256 = '19633c3801192627010826d2fcfc7c8a2acea269f6d7ff2396a7e69264832d5c';
const sha = value => createHash('sha256').update(value).digest('hex');
export function 核验迁移扩大整批批准(json, patch) {
  if (sha(json) !== 迁移扩大整批清单SHA256 || sha(patch) !== 迁移扩大整批差异SHA256) throw Error('迁移扩大整批批准指纹不符');
  const m = JSON.parse(json);
  if (m.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || m.差异SHA256 !== 迁移扩大整批差异SHA256 ||
    m.前置记录 !== '凭据网关任务-qD9PwY' || m.前置差异SHA256 !== '723841e0f57b5fb3bd21d9071b9223706833d4532ca3b3a463633e409eb1fb05' ||
    m.文件数 !== 67 || m.文件?.length !== 67 || new Set(m.文件.map(item => item.文件)).size !== 67 ||
    m.文件.filter(item => item.原始SHA256 === null).length !== 39 || m.自有来源与工具?.length !== 58 || m.冻结输入?.length !== 6 ||
    m.文件.some(item => !/^(?:画布副本\/(?:扩展功能|web\/src)|服务包\/扩展功能)\//.test(item.文件) || item.文件.split('/').includes('..'))) throw Error('迁移扩大整批批准范围不符');
  return m;
}
export function 读取迁移扩大整批批准() {
  return 核验迁移扩大整批批准(readFileSync(new URL('./待审查/迁移扩大整批.json', import.meta.url)), readFileSync(new URL('./待审查/迁移扩大整批.patch', import.meta.url)));
}
export function 核验迁移扩大整批来源(root) {
  const m = 读取迁移扩大整批批准();
  for (const item of [...m.自有来源与工具, ...m.冻结输入]) if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('迁移扩大整批来源偏离批准：' + item.文件);
  const old = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
  for (const sources of [m.旧来源, ...Object.values(m.继承旧来源)]) for (const [file, hash] of Object.entries(sources)) {
    if (SQLite安全指纹(old, file) !== hash) throw Error('迁移扩大整批旧来源改变：' + file);
  }
  return true;
}
