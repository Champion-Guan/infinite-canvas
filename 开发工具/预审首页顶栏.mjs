import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 预审类型, 生成审查差异 } from './检查首批功能适配.mjs';
import { 生成首页顶栏候选 } from './生成首页顶栏候选.mjs';

// 只生成待审查差异，绝不接入运行副本。新的作者核心边界需单独批准。
检查运行副本();
// 从锁定的前置功能批次重建，而不是把已接入的运行副本误当补丁前态。
const files = 生成首页顶栏候选();
预审类型(new Map([...files].filter(([path]) => path.endsWith('.tsx'))));
const patch = 生成审查差异(files);
const manifest = JSON.stringify({ 状态: '待用户单独批准，不应用', 上游提交: 基线.提交, 范围: '只让根首页使用迁入的旧顶栏，画布页不变；不启用已关闭主题/Agent/插件，不迁旧业务和数据', 预审类型通过: true, 差异SHA256: 哈希(patch), 文件: [...files].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })) }, null, 2) + '\n';
for (const [name, content] of [['首页顶栏原样接入.patch', patch], ['首页顶栏原样接入.json', manifest]]) {
  const target = join(根目录, '上游适配/待审查', name);
  if (existsSync(target) && readFileSync(target, 'utf8') !== content) throw Error('拒绝覆盖既有顶栏审查记录');
  if (!existsSync(target)) writeFileSync(target, content);
}
console.log(manifest);
