// 本次用户批准的独立五文件后继，历史67文件批准原件保持。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';

export const 收尾差异SHA256 = 'c6ac07e02b4af913067bc6c8e500cfa9f49920e90e8890716f0149b9c5f48b03';
export const 收尾清单SHA256 = '1e16eb142fdd72452364e6718d2752652917a08e9f490cbb55380ba7cf6e2761';
const sha = value => createHash('sha256').update(value).digest('hex');
const expectedPaths = ['components/layout/app-config-modal.tsx', 'i18n/locales/zh-CN.ts', 'i18n/locales/en-US.ts', 'services/image-storage.ts', 'guan/media/内嵌图片解码.mjs'].map(path => '画布副本/web/src/' + path);
export function 核验迁移扩大整批收尾批准(json, patch) {
  if (sha(json) !== 收尾清单SHA256 || sha(patch) !== 收尾差异SHA256) throw Error('收尾批准指纹不符');
  const m = JSON.parse(json);
  if (m.差异SHA256 !== 收尾差异SHA256 || m.前置差异SHA256 !== '009444d584648f349318edd6edd06e59edab70d98e13c89647ce920a2be3958e' ||
    m.文件数 !== 5 || m.文件?.length !== 5 || m.文件.some((item, i) => item.文件 !== expectedPaths[i]) ||
    m.文件.filter(item => item.原始SHA256 === null).length !== 1 || m.文件[4].原始SHA256 !== null || m.自有来源与工具?.length !== 3 || m.旧来源?.length !== 3) throw Error('收尾批准范围不符');
  return m;
}
export function 读取迁移扩大整批收尾批准() {
  return 核验迁移扩大整批收尾批准(readFileSync(new URL('./待审查/迁移扩大整批收尾.json', import.meta.url)), readFileSync(new URL('./待审查/迁移扩大整批收尾.patch', import.meta.url)));
}
export function 核验迁移扩大整批收尾来源(root) {
  const m = 读取迁移扩大整批收尾批准();
  for (const item of m.自有来源与工具) if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('收尾来源或工具改变：' + item.文件);
  const old = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
  for (const item of m.旧来源) if (SQLite安全指纹(old, item.文件) !== item.SHA256) throw Error('收尾旧来源改变：' + item.文件);
  return true;
}
