import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 检查扩大整批类型 } from './模型价格类型检查.mjs';
import { 构建模型价格与成功图片清理候选, 价格清理前置记录, 价格旧来源, 价格旧目录 } from './预审模型价格与成功图片清理.mjs';

// 六文件首件保持，七文件后继独立冻结；没有装配过六文件首件。
export function 构建模型价格全链与成功图片清理候选() {
  const preview = 构建模型价格与成功图片清理候选();
  for (const [file, hash] of [['模型价格与成功图片清理.patch', '7f4c5db88efd9cc45b7432d3b2bb8fa0a83cb75a10c9ff2b89b2ac9aa2ca80dd'], ['模型价格与成功图片清理.json', '89aa870d93df0137c2c932e28c540764c2cd56ded03c50fee162bf66dee0adc0']]) {
    if (哈希(readFileSync(join(根目录, '上游适配/待审查', file))) !== hash) throw Error('六文件首件改变');
  }
  const path = '画布副本/web/src/guan/config/配置文件安全.ts';
  const original = readFileSync(join(preview.integration.组合包, path), 'utf8');
  if (哈希(original) !== 'f703e850d553a23e83a0c51922db19a3f96128c70e9bf0c41836630f7ea69b50') throw Error('配置安全前态改变');
  if (哈希(readFileSync(join(价格旧目录, 'src/canvas/services/config-file.ts'))) !== 'b778666823951ebe597a0a443b3ca6b58097f43d3ad6318bdb2dcd639bdff1bf') throw Error('旧价格导出来源改变');
  preview.delta.set(path, { 原文: original, 产物: readFileSync(join(根目录, '扩展功能/配置文件/配置文件价格保留.ts'), 'utf8') });
  return preview;
}
export function 预审模型价格全链与成功图片清理(generate = false) {
  检查运行副本();
  const preview = 构建模型价格全链与成功图片清理候选(), types = 检查扩大整批类型(preview), patch = 生成审查差异(preview.delta);
  const sourceFiles = ['扩展功能/画布生成/图片任务确认恢复与清理.mjs', '扩展功能/配置文件/配置文件价格保留.ts', '开发工具/预审模型价格与成功图片清理.mjs', '开发工具/预审模型价格全链与成功图片清理.mjs', '开发工具/模型价格类型检查.mjs', '开发工具/模型价格类型依赖只读镜像.mjs'];
  const manifest = { 状态: '七文件完整候选，尚未批准或装配', 前置记录: 价格清理前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    取代未接入首件: '模型价格与成功图片清理', 文件数: preview.delta.size, 差异SHA256: 哈希(patch), 已接入: false, 已切换3100: false,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    旧来源: { ...价格旧来源, 'src/canvas/services/config-file.ts': 'b778666823951ebe597a0a443b3ca6b58097f43d3ad6318bdb2dcd639bdff1bf' },
    自有来源与工具: sourceFiles.map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(根目录, 文件))) })), 类型检查: types };
  if (generate) for (const [suffix, value] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查/模型价格全链与成功图片清理.' + suffix);
    if (existsSync(path)) { if (readFileSync(path, 'utf8') !== value) throw Error('拒绝覆盖冻结七文件后继'); }
    else writeFileSync(path, value, { flag: 'wx' });
  }
  检查运行副本(); return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(value => value !== '--生成审查差异')) throw Error('仅允许内存预审');
  console.log(JSON.stringify(预审模型价格全链与成功图片清理(process.argv.includes('--生成审查差异')), null, 2));
}
