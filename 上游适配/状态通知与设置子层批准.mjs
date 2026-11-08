// 2026-10-20用户明确批准的六文件后继；冻结预审与历史批准保持。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';
export const 子层差异SHA256 = '739161ddc40830b3fd8c55c7bd21c72faae4bbab89a24df9e55d8b714ace2943';
export const 子层清单SHA256 = 'd9e71cb1f530941bceeea9f6ca9344098b1b376146a0abeef3a30513ac7451bd';
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = ['guan/状态通知区.tsx', 'guan/SQLite应用入口.tsx', 'guan/保存状态条.tsx', 'guan/generation/图片任务确认状态.tsx', 'components/layout/channel-editor-drawer.tsx', 'components/layout/model-select-modal.tsx'].map(path => '画布副本/web/src/' + path);
export function 核验状态通知与设置子层批准(json, patch) {
  if (sha(json) !== 子层清单SHA256 || sha(patch) !== 子层差异SHA256) throw Error('子层批准指纹不符');
  const m = JSON.parse(json);
  if (m.差异SHA256 !== 子层差异SHA256 || m.前置差异SHA256 !== '1fde50893ca11167e33725c4e4f11d2418cfb0a1e0f29eea2ef6f541603c8a75' ||
    m.文件数 !== 6 || m.文件?.length !== 6 || m.文件.some((item, i) => item.文件 !== paths[i]) ||
    m.文件.filter(item => item.原始SHA256 === null).map(item => item.文件).join(',') !== paths[0] ||
    m.自有来源与工具?.length !== 2 || Object.hasOwn(m, '旧来源')) throw Error('子层批准范围不符');
  return m;
}
export function 读取状态通知与设置子层批准() {
  return 核验状态通知与设置子层批准(readFileSync(new URL('./待审查/状态通知与设置子层.json', import.meta.url)), readFileSync(new URL('./待审查/状态通知与设置子层.patch', import.meta.url)));
}
export function 核验状态通知与设置子层来源(root) {
  for (const item of 读取状态通知与设置子层批准().自有来源与工具) if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('子层来源或工具改变：' + item.文件);
  return true;
}
