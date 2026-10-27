import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 构建产品恢复挂载候选, 预审产品恢复挂载类型, 恢复挂载前置记录, 恢复挂载自有来源 } from './预审产品恢复挂载竞态.mjs';

const 首版差异SHA256 = '9b53379eced8bccde8f5fad5e0eca71da37ddc2c15281a1812bd5ae13b1137bf';
const 首版清单SHA256 = '4e8ff3f102cedb79440977ef1522ab8202b162c59f28eb969ba47d19e380627b';

// 第一版审查与历史批准保持原字节；后继只在内存中追加最小修订。
export function 构建产品恢复挂载复审候选() {
  const preview = 构建产品恢复挂载候选();
  if (哈希(生成审查差异(preview.delta)) !== 首版差异SHA256 ||
      哈希(readFileSync(join(根目录, '上游适配/待审查/产品恢复挂载竞态三文件.patch'))) !== 首版差异SHA256 ||
      哈希(readFileSync(join(根目录, '上游适配/待审查/产品恢复挂载竞态三文件.json'))) !== 首版清单SHA256)
    throw Error('首版候选或留存审查字节改变，不生成复审');
  const operations = preview.delta.get('web/src/guan/产品操作.ts');
  operations.产物 = 精确替换(operations.产物, [[
    '    if (activeId && useCanvasStore.getState().openProject(activeId))\n      await saves.flush(activeId);',
    '    // 恢复门禁中的产品尚未挂载、不能编辑；没有页面检查点，但仍须下方全局保存ACK。\n    if (activeId && !productRestoreMountGate.getSnapshot().includes(activeId)\n        && useCanvasStore.getState().openProject(activeId))\n      await saves.flush(activeId);',
  ]]);
  return preview;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--生成三文件复审') throw Error('仅生成复审，不接入或启动');
  检查运行副本();
  const preview = 构建产品恢复挂载复审候选();
  预审产品恢复挂载类型(preview);
  const patch = 生成审查差异(preview.delta);
  const manifest = {
    日期: '2026-10-19', 状态: '待具体差异批准，未接入或启动', 上游提交: 基线.提交,
    前置记录: 恢复挂载前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    被替代的未批准首版: { 差异SHA256: 首版差异SHA256, 清单SHA256: 首版清单SHA256, 接入: false },
    自有来源: { [恢复挂载自有来源]: 哈希(readFileSync(join(根目录, 恢复挂载自有来源))) },
    生成器: Object.fromEntries(['开发工具/预审产品恢复挂载竞态.mjs', '开发工具/复审产品恢复挂载竞态.mjs'].map(path => [path, 哈希(readFileSync(join(根目录, path)))])),
    差异SHA256: 哈希(patch), 文件数: preview.delta.size,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    完整虚拟候选类型检查通过: true, 已接入: false, 已重启3100: false, 真实浏览器验收: false,
    范围: ['恢复ID在业务状态发布前封住挂载；根ACK、导航偏好ACK及导航发起后才放行',
      '原网址仍指向恢复ID时，重试不要求尚未挂载的检查点；全局保存及其他当前画布检查点保持',
      '根/偏好/导航失败不放行；保留快照和显式重试；其他产品实例不卸载',
      '仅当前网址指向未确认恢复产品时显示状态提示；不改既有胶囊与弹窗视觉',
      '不修改SQLite桥、授权、限流、媒体白名单、历史批准/保护器或作者文件'],
  };
  for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']])
    writeFileSync(join(根目录, '上游适配/待审查/产品恢复挂载竞态三文件复审.' + suffix), value, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(manifest, null, 2));
}
