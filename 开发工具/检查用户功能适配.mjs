import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { 根目录, 上游目录, 基线, 检查 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { 生成候选 as 生成首批候选, 精确替换, 预审类型, 生成审查差异 } from './检查首批功能适配.mjs';
import { 状态, 上游提交, 自有模块, 接入差异 } from '../上游适配/用户已选功能关闭.mjs';
import { closedFeatureIds } from '../扩展功能/产品配置/用户已选功能.ts';

export function 生成用户候选() {
  检查();
  if (状态 !== '待单独批准' || 上游提交 !== 基线.提交) throw Error('用户功能候选状态或锁定上游不符。');
  const 文件 = 生成首批候选();
  for (const 项 of 接入差异) {
    if (!/^web\/src\/(?:[\w-]+\/)*[\w-]+\.(?:ts|tsx)$/.test(项.文件)) throw Error('适配路径非法。');
    const 原文 = readFileSync(join(上游目录, 项.文件), 'utf8');
    const 当前 = 文件.get(项.文件)?.产物 ?? 原文;
    文件.set(项.文件, { 原文, 产物: 精确替换(当前, 项.替换) });
  }
  for (const 项 of 自有模块) {
    文件.set(项.产物, { 原文: null, 产物: readFileSync(join(根目录, 项.来源), 'utf8') });
  }
  return 文件;
}

export function 检查用户功能适配({ 生成差异 = false } = {}) {
  检查运行副本();
  const 文件 = 生成用户候选();
  预审类型(文件);
  const patch = 生成审查差异(文件);
  const check = spawnSync('git', ['-C', 上游目录, 'apply', '--check', '-'], { input: patch, encoding: 'utf8' });
  if (check.status !== 0) throw Error(`差异预检查失败：${check.stderr}`);
  const hash = content => createHash('sha256').update(content).digest('hex');
  const 清单 = {
    状态, 上游提交, 用户已选关闭: closedFeatureIds, 已应用到运行副本: false, 预审类型通过: true,
    差异SHA256: hash(patch),
    文件: [...文件].map(([路径, 项]) => ({ 文件: 路径, 原始SHA256: 项.原文 === null ? null : hash(项.原文), 候选SHA256: hash(项.产物) })),
  };
  if (生成差异) {
    const dir = join(根目录, '上游适配/待审查');
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of [['用户已选功能关闭.patch', patch], ['用户已选功能关闭.json', JSON.stringify(清单, null, 2) + '\n']]) {
      const target = join(dir, name);
      if (existsSync(target) && readFileSync(target, 'utf8') !== content) throw Error('拒绝覆盖不同版本的审查产物。');
      if (!existsSync(target)) writeFileSync(target, content);
    }
  }
  检查运行副本();
  console.log(JSON.stringify(清单, null, 2));
  return 清单;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.some(arg => /应用|apply|启用/.test(arg))) throw Error('本工具只预审，不应用；具体 diff 仍需单独批准。');
  检查用户功能适配({ 生成差异: process.argv.includes('--生成审查差异') });
}
