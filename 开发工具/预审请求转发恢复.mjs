import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 预审类型, 生成审查差异 } from './检查首批功能适配.mjs';
import { 读取顶栏单来源批准, 顶栏单来源差异SHA256 } from '../上游适配/顶栏单来源批准.mjs';
import { 请求转发前态指纹 } from '../上游适配/请求转发恢复批准.mjs';
import { 状态, 上游提交, 前置差异SHA256, 策略路径, 替换, 恢复内容, 不包含 } from '../上游适配/请求转发恢复.mjs';

export function 生成请求转发候选() {
  if (状态 !== '待单独批准' || 上游提交 !== 基线.提交 || 前置差异SHA256 !== 顶栏单来源差异SHA256) throw Error('请求转发恢复的基线或前置差异不符');
  // 这个策略仅经历过U02编号移除和主题开关恢复再关闭，最终主题值仍与初始值一致。
  // 从自有权威源码重建这一份精确前态，锁定完整历史指纹；不为1文件递归重建所有历史UI。
  const source = readFileSync(join(根目录, '扩展功能/产品配置/用户已选功能.ts'), 'utf8');
  const before = 精确替换(source, [['    "U01", "U02", "U03", "U04", "S07", "S08",', '    "U01", "U03", "U04", "S07", "S08",']]);
  const item = 读取顶栏单来源批准().文件.find(item => item.文件 === 策略路径);
  if (!item || typeof before !== 'string' || 哈希(before) !== item.候选SHA256) throw Error('请求转发策略前态不符');
  return new Map([[策略路径, { 原文: before, 产物: 精确替换(before, 替换) }]]);
}

export function 预审请求转发({ 完整类型 = false, 生成差异 = false } = {}) {
  const state = 检查运行副本();
  if (!state.顶栏单来源已应用) throw Error('需先接入完整顶栏单来源批次');
  const files = 生成请求转发候选();
  for (const [path, item] of files) if (请求转发前态指纹(运行目录, path) !== 哈希(item.原文)) throw Error('当前副本不是已批准的请求转发前态或完整后态');
  if (完整类型) 预审类型(files);
  const patch = 生成审查差异(files);
  const check = spawnSync('git', ['-C', 运行目录, 'apply', ...(state.请求转发已恢复 ? ['--reverse'] : []), '--check', '--whitespace=error', '-'], { input: patch, encoding: 'utf8' });
  if (check.status !== 0) throw Error('请求转发差异检查失败：' + check.stderr);
  const manifest = {
    状态, 上游提交, 前置差异SHA256, 恢复内容, 不包含,
    已应用到运行副本: false, 完整类型预审通过: 完整类型, 标准差异检查通过: true,
    差异SHA256: 哈希(patch),
    文件: [...files].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
  };
  if (生成差异) {
    if (!完整类型) throw Error('保存审查快照前须先通过完整类型预审');
    const dir = join(根目录, '上游适配/待审查');
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of [['请求转发恢复.patch', patch], ['请求转发恢复.json', JSON.stringify(manifest, null, 2) + '\n']]) {
      const target = join(dir, name);
      if (existsSync(target) && readFileSync(target, 'utf8') !== content) throw Error('不覆盖已有的不同审查快照');
      if (!existsSync(target)) writeFileSync(target, content);
    }
  }
  检查运行副本();
  console.log(JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => !['--完整类型预审', '--生成审查差异'].includes(arg))) throw Error('仅供预审，不能应用或启动请求转发');
  预审请求转发({ 完整类型: process.argv.includes('--完整类型预审'), 生成差异: process.argv.includes('--生成审查差异') });
}
