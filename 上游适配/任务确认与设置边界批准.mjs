// 2026-10-20用户明确批准的独立九文件后继；冻结预审原件和所有历史批准保持。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';
export const 确认边界差异SHA256 = '1fde50893ca11167e33725c4e4f11d2418cfb0a1e0f29eea2ef6f541603c8a75';
export const 确认边界清单SHA256 = '96471e9995e0f98956a0ba2581ba83c1fb819524397f5d07d29dda1978271b7a';
const sha = value => createHash('sha256').update(value).digest('hex');
const expectedPaths = ['guan/generation/生成任务客户端.mjs', 'guan/generation/图片任务衔接.mjs', 'guan/generation/图片任务确认恢复.mjs', 'guan/generation/图片任务确认状态.tsx', 'pages/canvas/project.tsx', 'guan/设置视区.tsx', 'layouts/user-layout.tsx', 'guan/旧版首页顶栏.tsx', 'components/layout/app-config-modal.tsx'].map(path => '画布副本/web/src/' + path);
export function 核验任务确认与设置边界批准(json, patch) {
  if (sha(json) !== 确认边界清单SHA256 || sha(patch) !== 确认边界差异SHA256) throw Error('确认边界批准指纹不符');
  const m = JSON.parse(json);
  if (m.差异SHA256 !== 确认边界差异SHA256 || m.前置差异SHA256 !== 'c6ac07e02b4af913067bc6c8e500cfa9f49920e90e8890716f0149b9c5f48b03' ||
    m.文件数 !== 9 || m.文件?.length !== 9 || m.文件.some((item, i) => item.文件 !== expectedPaths[i]) ||
    m.文件.filter(item => item.原始SHA256 === null).map(item => item.文件).join(',') !== [2,3,5].map(i => expectedPaths[i]).join(',') ||
    m.自有来源与工具?.length !== 7 || m.旧来源?.length !== 2) throw Error('确认边界批准范围不符');
  return m;
}
export function 读取任务确认与设置边界批准() {
  return 核验任务确认与设置边界批准(readFileSync(new URL('./待审查/任务确认与设置边界.json', import.meta.url)), readFileSync(new URL('./待审查/任务确认与设置边界.patch', import.meta.url)));
}
export function 核验任务确认与设置边界来源(root) {
  const m = 读取任务确认与设置边界批准();
  for (const item of m.自有来源与工具) if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('确认边界来源或工具改变：' + item.文件);
  const old = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
  for (const item of m.旧来源) if (SQLite安全指纹(old, item.文件) !== item.SHA256) throw Error('确认边界旧来源改变：' + item.文件);
  return true;
}
