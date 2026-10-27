// 仅生成一文件后继审查，不接入任何副本，不覆盖七文件批准对象。
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 读取工作簿删除隔离记录 } from './接入Excel工作簿删除隔离副本.mjs';

export const 删除视觉前置 = join(根目录, '.运行/Excel工作簿删除-hoIPDn/Excel工作簿删除接入记录.json');
export const 删除视觉来源 = '扩展功能/Excel删除视觉/工作簿删除弹窗.tsx';
export function 构建删除视觉候选() {
  const integration = 读取工作簿删除隔离记录(删除视觉前置);
  const path = 'web/src/guan/工作簿删除弹窗.tsx';
  const 原文 = readFileSync(join(integration.副本, path), 'utf8');
  const file = join(根目录, 删除视觉来源), stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('视觉候选必须是独立普通文件');
  const 产物 = readFileSync(file, 'utf8');
  // 只允许五处局部style，删除、保存、门禁与文案逐字保持。
  const stripped = 产物.replace(' style={{ fontFamily: "ui-sans-serif, -apple-system, system-ui, \\"Segoe UI\\", sans-serif", fontSize: 16, lineHeight: "24px", color: "var(--dc-text)" }}', '')
    .replace(' style={{ fontWeight: 400 }}', '').replaceAll(' style={{ font: "inherit" }}', '');
  if (stripped !== 原文 || (产物.match(/style=\{/g) ?? []).length !== 5) throw Error('拒绝样式以外的候选变化');
  return { integration, delta: new Map([[path, { 原文, 产物 }]]) };
}
export function 预审删除视觉(generate = false) {
  const preview = 构建删除视觉候选();
  预审卡片布局类型(preview);
  const patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-19', 状态: '待具体批准；仅内存候选，未接入运行包', 上游提交: 基线.提交,
    前置记录: 删除视觉前置, 前置差异SHA256: preview.integration.差异SHA256,
    差异SHA256: 哈希(patch), 文件数: 1, 完整虚拟类型检查通过: true, 已接入: false, 已接管3100: false,
    自有来源: [{ 文件: 删除视觉来源, SHA256: 哈希(readFileSync(join(根目录, 删除视觉来源))) }],
    工具来源: ['开发工具/预审Excel删除视觉继承.mjs', '开发工具/Excel删除视觉继承.test.mjs'].map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(根目录, 文件))) })),
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })) };
  if (generate) for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const file = join(根目录, '上游适配/待审查/Excel删除视觉继承一文件.' + suffix);
    if (existsSync(file)) throw Error('拒绝覆盖已生成视觉审查原件');
    writeFileSync(file, value, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('未知预审参数');
  console.log(JSON.stringify(预审删除视觉(process.argv.includes('--生成审查差异')), null, 2));
}
