import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQLite安全指纹, SQLite自有依赖通过, 读取SQLite批准 } from './SQLite全面替换批准.mjs';
import { 读取节点存储批准 } from './SQLite节点存储批准.mjs';
import { 读取启动存储批准, 核验启动存储自有依赖, 启动存储差异SHA256 } from './SQLite启动存储批准.mjs';

// 用户于本轮明确批准已展示的复审9文件差异。只允许新隔离副本，不接管3100。
// 原审批JSON/patch及历史保护器保持原字节和语义。
export const 授权入口差异SHA256 = '80e8684475fdfb0649215cb719d75e35a2635286027c2be7203f45595ce36331';
export const 授权入口清单SHA256 = 'c971e022cc682b18e52439be98676f3797808ec1b4164debb3cd549965d30062';
const sha = value => createHash('sha256').update(value).digest('hex');
const names = ['协议.mjs', '浏览器适配.mjs', '续期数据客户端.mjs', '应用值编码.mjs', '应用存储适配.mjs', '本机授权客户端.mjs', '工作台授权入口.mjs', '启动工作台.mjs'];
const paths = ['web/index.html', ...names.map(name => 'web/src/guan/sqlite/' + name)];

export function 核验授权入口批准(json, patch) {
  if (sha(json) !== 授权入口清单SHA256 || sha(patch) !== 授权入口差异SHA256) throw Error('授权入口批准指纹不符');
  const manifest = JSON.parse(json), parent = 读取启动存储批准();
  if (manifest.差异SHA256 !== 授权入口差异SHA256 || manifest.上游提交 !== parent.上游提交 || manifest.前置启动存储差异SHA256 !== 启动存储差异SHA256 ||
    manifest.文件.length !== 9 || manifest.文件.some((item, index) => item.文件 !== paths[index] || (index > 0 && item.原始SHA256 !== null)) ||
    manifest.文件[0].原始SHA256 !== parent.文件.find(item => item.文件 === 'web/index.html')?.候选SHA256) throw Error('授权入口批准范围或前置不符');
  return manifest;
}
export function 读取授权入口批准() {
  return 核验授权入口批准(readFileSync(new URL('./待审查/SQLite工作台授权入口复审.json', import.meta.url)), readFileSync(new URL('./待审查/SQLite工作台授权入口复审.patch', import.meta.url)));
}
export function 核验授权入口自有依赖(root) {
  核验启动存储自有依赖(root);
  for (const item of [...读取授权入口批准().自有来源, ...读取授权入口批准().启动器来源]) {
    if (!SQLite自有依赖通过(root, item)) throw Error('授权入口自有依赖偏离批准内容：' + item.文件);
  }
}
// HTML是启动3文件的精确后继，不能让历史检查器接受新HTML或任意后继。
// 此处独立核验25文件、节点修正、启动3文件及本9文件全前态/全后态。
export function 检查授权入口后继(root) {
  const manifest = 读取授权入口批准(), delta = new Map(manifest.文件.map(item => [item.文件, item]));
  const prerequisite = new Map(读取SQLite批准().文件.map(item => [item.文件, item.候选SHA256]));
  for (const item of [...读取节点存储批准().文件, ...读取启动存储批准().文件]) prerequisite.set(item.文件, item.候选SHA256);
  for (const [path, hash] of prerequisite) if (!delta.has(path) && SQLite安全指纹(root, path) !== hash) throw Error('授权入口前置不完整或未知改动：' + path);
  let before = 0, after = 0;
  for (const item of manifest.文件) {
    const hash = SQLite安全指纹(root, item.文件);
    if (hash === item.原始SHA256) before++;
    else if (hash === item.候选SHA256) after++;
    else throw Error('授权入口存在未知改动：' + item.文件);
  }
  if (before && after) throw Error('授权入口批次不完整');
  const directory = join(root, 'web/src/guan/sqlite');
  if (existsSync(directory)) {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw Error('授权模块目录类型或链接不安全');
    for (const entry of readdirSync(directory, { withFileTypes: true })) if (!names.includes(entry.name) || !entry.isFile()) throw Error('授权模块目录出现未知文件或目录');
  }
  return after === 9;
}
