// 对实际字体渲染差异的局部后继，仅生成待审查差异，不能接入运行包。
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 读取Excel删除视觉继承隔离记录 } from './接入Excel删除视觉继承隔离副本.mjs';

export const 删除平滑前置 = join(根目录, '.运行/Excel删除视觉继承-0VYu50/Excel删除视觉继承接入记录.json');
export const 删除平滑来源 = '扩展功能/Excel删除字体平滑/工作簿删除弹窗.tsx';
export function 构建删除平滑候选() {
  const integration = 读取Excel删除视觉继承隔离记录(删除平滑前置);
  const path = 'web/src/guan/工作簿删除弹窗.tsx';
  const 原文 = readFileSync(join(integration.副本, path), 'utf8');
  const file = join(根目录, 删除平滑来源), stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('平滑来源不是独立普通文件');
  const 产物 = readFileSync(file, 'utf8');
  const before = 'fontFamily: "ui-sans-serif, -apple-system, system-ui, \\"Segoe UI\\", sans-serif"';
  const after = 'fontFamily: "ui-sans-serif, -apple-system, \\"system-ui\\", \\"Segoe UI\\", sans-serif", WebkitFontSmoothing: "antialiased"';
  if (原文.split(before).length !== 2 || 原文.replace(before, after) !== 产物) throw Error('拒绝字体渲染以外的变化');
  return { integration, delta: new Map([[path, { 原文, 产物 }]]) };
}
export function 预审删除平滑(generate = false) {
  const preview = 构建删除平滑候选(); 预审卡片布局类型(preview);
  const patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-20', 状态: '待具体批准；仅内存候选，未接入运行包', 上游提交: 基线.提交,
    前置记录: 删除平滑前置, 前置差异SHA256: preview.integration.差异SHA256, 差异SHA256: 哈希(patch),
    文件数: 1, 完整虚拟类型检查通过: true, 已接入: false, 已接管3100: false,
    自有来源: [{ 文件: 删除平滑来源, SHA256: 哈希(readFileSync(join(根目录, 删除平滑来源))) }],
    工具来源: ['开发工具/预审Excel删除字体平滑.mjs', '开发工具/Excel删除字体平滑.test.mjs'].map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(根目录, 文件))) })),
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })) };
  if (generate) for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const file = join(根目录, '上游适配/待审查/Excel删除字体平滑一文件.' + suffix);
    if (existsSync(file)) throw Error('拒绝覆盖平滑审查原件');
    writeFileSync(file, value, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('未知预审参数');
  console.log(JSON.stringify(预审删除平滑(process.argv.includes('--生成审查差异')), null, 2));
}
