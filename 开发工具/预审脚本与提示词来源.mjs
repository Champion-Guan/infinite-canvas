import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { 根目录, 上游目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 预审类型, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 状态, 上游提交, 关闭编号, 自有模块, 接入差异 } from '../上游适配/脚本与提示词来源关闭.mjs';
import { 生成用户候选 } from './检查用户功能适配.mjs';

export function 生成脚本来源候选() {
  if (状态 !== '待单独批准' || 上游提交 !== 基线.提交) throw Error('脚本来源关闭状态或锁定基线不符');
  if (!检查运行副本().右上双入口关闭已应用) throw Error('先完成已批准双入口接入');
  // 从锁定作者基线与既有32项精确产物重建前态，接入后仍可重现同一审查指纹。
  const previous = 生成用户候选();
  const files = new Map();
  for (const item of 接入差异) {
    const before = previous.get(item.文件)?.产物 ?? readFileSync(join(上游目录, item.文件), 'utf8');
    files.set(item.文件, { 原文: before, 产物: 精确替换(before, item.替换) });
  }
  files.set(自有模块.产物, { 原文: null, 产物: readFileSync(join(根目录, 自有模块.来源), 'utf8') });
  return files;
}

export function 预审脚本来源({ 生成差异 = false, 完整类型 = false } = {}) {
  const files = 生成脚本来源候选();
  for (const [fileName, item] of files) {
    const { diagnostics } = ts.transpileModule(item.产物, { fileName, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
    if (diagnostics?.length) throw Error('候选语法错误：' + fileName);
  }
  if (完整类型) 预审类型(files);
  const patch = 生成审查差异(files);
  const applied = 检查运行副本().脚本与提示词来源关闭已应用;
  const result = spawnSync('git', ['-C', 运行目录, 'apply', ...(applied ? ['--reverse'] : []), '--check', '-'], { input: patch, encoding: 'utf8' });
  if (result.status !== 0) throw Error('标准差异检查失败：' + result.stderr);
  const manifest = {
    状态, 上游提交, 关闭编号,
    前置双入口差异SHA256: '84ce03a198345769f2314e0e7dc220b1030a7f9d93152ff410125036afc425ef',
    已应用到运行副本: false, 语法预审通过: true, 完整类型预审通过: 完整类型, 标准差异检查通过: true,
    差异SHA256: 哈希(patch),
    文件: [...files].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
  };
  if (生成差异) {
    const dir = join(根目录, '上游适配/待审查'); mkdirSync(dir, { recursive: true });
    for (const [name, content] of [['脚本与提示词来源关闭.patch', patch], ['脚本与提示词来源关闭.json', JSON.stringify(manifest, null, 2) + '\n']]) {
      const path = join(dir, name);
      if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖不同审查产物');
      if (!existsSync(path)) writeFileSync(path, content);
    }
  }
  检查运行副本(); console.log(JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => !['--生成审查差异', '--完整类型预审'].includes(arg))) throw Error('只允许预审，不提供应用权限');
  预审脚本来源({ 生成差异: process.argv.includes('--生成审查差异'), 完整类型: process.argv.includes('--完整类型预审') });
}
