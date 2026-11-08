import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 运行目录, 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 生成用户候选 } from './检查用户功能适配.mjs';
import { 预审类型, 生成审查差异 } from './检查首批功能适配.mjs';
import { 批准差异SHA256 } from '../上游适配/用户已选功能批准.mjs';

export const 首页映射 = [
  ['扩展功能/首页/画布入口候选.tsx', 'web/src/guan/画布入口.tsx'],
  ['扩展功能/首页/工作台首页.tsx', 'web/src/guan/工作台首页.tsx'],
  ['扩展功能/首页/首页.module.css', 'web/src/guan/首页.module.css'],
];

export function 生成首页候选() {
  if (!检查运行副本().用户功能关闭已应用) throw Error('需要完整已批准功能基线。');
  const 全量 = 生成用户候选();
  const 增量 = new Map();
  for (const [来源, 目标] of 首页映射) {
    const 前置 = 全量.get(目标);
    const 原文 = 前置?.产物 ?? null;
    const 项 = { 原文, 产物: readFileSync(join(根目录, 来源), 'utf8') };
    if (existsSync(join(运行目录, 目标))) {
      const 当前 = readFileSync(join(运行目录, 目标), 'utf8');
      if (当前 !== 原文 && 当前 !== 项.产物) throw Error('首页文件有未知内容，停止。');
    } else if (前置) throw Error('自有入口前置文件缺失。');
    增量.set(目标, 项);
    if (目标.endsWith('.tsx')) 全量.set(目标, 项);
  }
  const 图片清单原文 = readFileSync(join(根目录, '界面资源/首页轮播/图片清单.json'));
  const 图片清单 = JSON.parse(图片清单原文);
  if (图片清单.文件.length !== 30 || new Set(图片清单.文件.map(item => item.产物)).size !== 30) throw Error('轮播素材清单不符。');
  const 资源 = new Map();
  for (const item of 图片清单.文件) {
    if (!/^界面资源\/首页轮播\/第[123]组-(商品图[123]|详情长图1|效果图[1-6])\.webp$/.test(item.来源) || item.产物 !== 'web/public/guan/首页轮播/' + item.来源.split('/').at(-1)) throw Error('非法素材路径');
    const bytes = readFileSync(join(根目录, item.来源));
    if (bytes.length !== item.字节 || 哈希(bytes) !== item.SHA256) throw Error('首页图片与清单指纹不符');
    资源.set(item.产物, { 原文: null, 产物: bytes });
  }
  return { 全量, 增量, 资源, 图片清单SHA256: 哈希(图片清单原文) };
}

export function 预审首页({ 生成差异 = false } = {}) {
  const { 全量, 增量, 资源, 图片清单SHA256 } = 生成首页候选();
  预审类型(全量);
  const patch = 生成审查差异(增量);
  const 已接入 = 检查运行副本().首页替换已应用 === true;
  const result = spawnSync('git', ['-C', 运行目录, 'apply', '--check', ...(已接入 ? ['--reverse'] : []), '-'], { input: patch, encoding: 'utf8' });
  if (result.status !== 0) throw Error(`首页候选差异检查失败：${result.stderr}`);
  const 清单 = {
    状态: '用户已批准首页替换及原图迁入，实际接入状态见运行保护与验收', 上游提交: 基线.提交, 前置批准差异SHA256: 批准差异SHA256,
    前置首页审查SHA256: 'c219fe373e41d0adefcc5fcd16dd9d324cdb9cffa7b86b44f40dae822b961800', 图片清单SHA256,
    类型预审通过: true, 差异检查通过: true, 差异SHA256: 哈希(patch),
    文件: [...增量].map(([文件, 项]) => ({ 文件, 原始SHA256: 项.原文 === null ? null : 哈希(项.原文), 候选SHA256: 哈希(项.产物) })),
    资源: [...资源].map(([文件, 项]) => ({ 文件, 原始SHA256: null, 候选SHA256: 哈希(项.产物), 字节: 项.产物.length })),
  };
  if (生成差异) {
    const dir = join(根目录, '上游适配/待审查');
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of [['首页原图接入.patch', patch], ['首页原图接入.json', JSON.stringify(清单, null, 2) + '\n']]) {
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
  if (process.argv.some(arg => /应用|apply|启用/.test(arg))) throw Error('只预审，不写正在运行的副本。');
  预审首页({ 生成差异: process.argv.includes('--生成审查差异') });
}
