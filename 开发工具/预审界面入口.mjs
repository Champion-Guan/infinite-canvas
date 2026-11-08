import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { 根目录, 上游目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 生成用户候选 } from './检查用户功能适配.mjs';
import { 精确替换, 预审类型, 生成审查差异 } from './检查首批功能适配.mjs';
import { 批准差异SHA256 } from '../上游适配/用户已选功能批准.mjs';
import { 状态, 上游提交, 自有模块, 接入差异 } from '../上游适配/界面入口关闭.mjs';

export function 生成入口候选() {
  if (状态 !== '待单独批准' || 上游提交 !== 基线.提交) throw Error('入口预审状态或上游基线不符。');
  const 保护 = 检查运行副本();
  if (!保护.用户功能关闭已应用) throw Error('必须先完整接入已批准功能基线。');
  const 全量 = 生成用户候选();
  const 增量 = new Map();
  for (const 项 of 接入差异) {
    // 历史候选必须从当时的权威基线重建；不能借新品牌接入变成新的空标题补丁。
    let 原文 = 全量.get(项.文件)?.产物 ?? readFileSync(join(上游目录, 项.文件), 'utf8');
    const 基线内容 = 全量.get(项.文件)?.产物;
    // 旧5文件候选只供追溯：以原功能基线重建，不把已批准2文件接入重设为新许可。
    if (保护.右上双入口关闭已应用 && 项.文件 === 'web/src/components/layout/user-status-actions.tsx') 原文 = 基线内容;
    if (基线内容 !== undefined && 原文 !== 基线内容) throw Error('入口前置内容不符。');
    const 产物 = 精确替换(原文, 项.替换);
    增量.set(项.文件, { 原文, 产物 });
    if (项.文件.endsWith('.tsx')) 全量.set(项.文件, { 原文, 产物 });
  }
  const 模块 = { 原文: null, 产物: readFileSync(join(根目录, 自有模块.来源), 'utf8') };
  if (existsSync(join(运行目录, 自有模块.产物))) throw Error('待批准模块已存在，停止预审。');
  增量.set(自有模块.产物, 模块);
  全量.set(自有模块.产物, 模块);
  return { 全量, 增量 };
}

export function 预审入口({ 生成差异 = false } = {}) {
  if (检查运行副本().右上双入口关闭已应用) throw Error('旧5文件候选仅供追溯；当前仅批准2文件双入口，不再对旧差异做应用预检。');
  const { 全量, 增量 } = 生成入口候选();
  预审类型(全量);
  const patch = 生成审查差异(增量);
  const result = spawnSync('git', ['-C', 运行目录, 'apply', '--check', '-'], { input: patch, encoding: 'utf8' });
  if (result.status !== 0) throw Error(`入口差异检查失败：${result.stderr}`);
  const 清单 = {
    状态, 上游提交, 前置批准差异SHA256: 批准差异SHA256,
    已应用到运行副本: false, 类型预审通过: true, 差异检查通过: true,
    差异SHA256: 哈希(patch),
    文件: [...增量].map(([文件, 项]) => ({ 文件, 原始SHA256: 项.原文 === null ? null : 哈希(项.原文), 候选SHA256: 哈希(项.产物) })),
  };
  if (生成差异) {
    const dir = join(根目录, '上游适配/待审查');
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of [['界面入口关闭.patch', patch], ['界面入口关闭.json', JSON.stringify(清单, null, 2) + '\n']]) {
      const target = join(dir, name);
      if (existsSync(target) && readFileSync(target, 'utf8') !== content) throw Error('拒绝覆盖不同审查产物。');
      if (!existsSync(target)) writeFileSync(target, content);
    }
  }
  检查运行副本();
  console.log(JSON.stringify(清单, null, 2));
  return 清单;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.some(arg => /应用|apply|启用/.test(arg))) throw Error('仅预审，具体差异仍需单独批准。');
  预审入口({ 生成差异: process.argv.includes('--生成审查差异') });
}
