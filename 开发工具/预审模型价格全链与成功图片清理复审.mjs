import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 检查扩大整批类型 } from './模型价格类型检查.mjs';
import { 构建模型价格全链与成功图片清理候选 } from './预审模型价格全链与成功图片清理.mjs';

export function 构建模型价格全链与成功图片清理复审候选() {
  const preview = 构建模型价格全链与成功图片清理候选();
  for (const [suffix, hash] of [['patch', '602698e1ccb66c9a98c5c4eb39b02b2bbf1e03ffa0f2e11689c0398ef6c7dd5a'], ['json', 'bd9d7fe9fe3c440598d0f2f2bb8eed4abd6e93bb6704168db0957fcd7f840aee']]) {
    if (哈希(readFileSync(join(根目录, '上游适配/待审查/模型价格全链与成功图片清理.' + suffix))) !== hash) throw Error('七文件首件改变');
  }
  const path = '画布副本/web/src/guan/generation/图片任务确认恢复.mjs', item = preview.delta.get(path);
  // 自有模块目录与画布目录不同，使用现有受限SQLite协议，不新增运行依赖。
  preview.delta.set(path, { ...item, 产物: 精确替换(item.产物, [["from '../本机存储/协议.mjs'", "from '../sqlite/协议.mjs'"]]) });
  return preview;
}
export function 预审模型价格全链与成功图片清理复审(generate = false) {
  检查运行副本();
  const preview = 构建模型价格全链与成功图片清理复审候选(), types = 检查扩大整批类型(preview), patch = 生成审查差异(preview.delta);
  const previous = JSON.parse(readFileSync(join(根目录, '上游适配/待审查/模型价格全链与成功图片清理.json')));
  const source = '开发工具/预审模型价格全链与成功图片清理复审.mjs';
  const manifest = { ...previous, 状态: '七文件复审候选，尚未批准或装配', 取代未接入首件: ['模型价格与成功图片清理', '模型价格全链与成功图片清理'],
    差异SHA256: 哈希(patch), 文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    自有来源与工具: [...previous.自有来源与工具, { 文件: source, SHA256: 哈希(readFileSync(join(根目录, source))) }], 类型检查: types };
  if (generate) for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查/模型价格全链与成功图片清理复审.' + suffix);
    if (existsSync(path)) { if (readFileSync(path, 'utf8') !== value) throw Error('拒绝覆盖冻结复审后继'); }
    else writeFileSync(path, value, { flag: 'wx' });
  }
  检查运行副本(); return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(value => value !== '--生成审查差异')) throw Error('仅允许内存预审');
  console.log(JSON.stringify(预审模型价格全链与成功图片清理复审(process.argv.includes('--生成审查差异')), null, 2));
}
