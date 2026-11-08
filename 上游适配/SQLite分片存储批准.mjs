import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQLite安全指纹, 读取SQLite批准 } from './SQLite全面替换批准.mjs';
import { 读取节点存储批准 } from './SQLite节点存储批准.mjs';
import { 读取启动存储批准 } from './SQLite启动存储批准.mjs';
import { 读取授权入口批准 } from './SQLite工作台授权入口批准.mjs';
import { 媒体启动器路径, 媒体启动器依赖 } from './SQLite临时媒体策略批准.mjs';
import { 读取免填码批准 } from './SQLite免填码启动批准.mjs';
import { 读取保存恢复批准, 核验保存恢复自有依赖, 保存恢复差异SHA256 } from './SQLite保存恢复批准.mjs';

// 用户批准精确4文件，仅新隔离副本；历史源码、批准器与审查快照不变。
export const 分片存储差异SHA256 = 'af8fc45383cbb37853cdf06cc0c9d9d07b947a7ed74b3768e8f068dbf69d2aa5';
export const 分片存储清单SHA256 = 'c1facd70bcfefa23946028ecfbc781ce91efa7c2bb1664ca9745123ec4688f52';
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = ['web/src/guan/sqlite/工作台自动入口.mjs', 'web/src/guan/sqlite/分片值编码.mjs', 'web/src/guan/sqlite/分片应用存储.mjs', 'web/src/guan/sqlite/可恢复分片应用存储.mjs'];
function prerequisites() {
  const prior = new Map();
  for (const batch of [读取SQLite批准(), 读取节点存储批准(), 读取启动存储批准(), 读取授权入口批准(), 读取免填码批准(), 读取保存恢复批准()]) {
    for (const item of batch.文件) prior.set(item.文件, item.候选SHA256);
  }
  return prior;
}
export function 核验分片存储批准(json, patch) {
  if (sha(json) !== 分片存储清单SHA256 || sha(patch) !== 分片存储差异SHA256) throw Error('分片存储批准指纹不符');
  const manifest = JSON.parse(json), prior = prerequisites();
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 分片存储差异SHA256 ||
    manifest.前置保存恢复差异SHA256 !== 保存恢复差异SHA256 || manifest.文件.length !== 4 ||
    manifest.文件.some((item, index) => item.文件 !== paths[index] || item.原始SHA256 !== (prior.get(item.文件) ?? null))) throw Error('分片存储批准范围或前置不符');
  return manifest;
}
export function 读取分片存储批准() {
  return 核验分片存储批准(readFileSync(new URL('./待审查/SQLite分片存储.json', import.meta.url)), readFileSync(new URL('./待审查/SQLite分片存储.patch', import.meta.url)));
}
export function 核验分片存储自有依赖(root) {
  核验保存恢复自有依赖(root);
  const manifest = 读取分片存储批准();
  for (const target of paths.slice(1)) {
    const source = '扩展功能/本机存储/' + target.split('/').at(-1);
    if (SQLite安全指纹(root, source) !== manifest.文件.find(item => item.文件 === target).候选SHA256) throw Error('分片存储自有来源未知改动：' + source);
  }
}
function exactTree(root, directory, files) {
  if (!existsSync(join(root, directory))) return;
  const directories = new Set();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  function walk(path) {
    const stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('分片存储模块目录类型或链接不安全');
    for (const name of readdirSync(join(root, path))) {
      const relative = path + '/' + name, current = lstatSync(join(root, relative));
      if (current.isDirectory() && directories.has(relative)) walk(relative);
      else if (!current.isFile() || current.nlink !== 1 || !files.has(relative)) throw Error('分片存储模块出现未知文件、目录或链接');
    }
  }
  walk(directory);
}
export function 检查分片存储后继(root) {
  const manifest = 读取分片存储批准(), delta = new Map(manifest.文件.map(item => [item.文件, item])), prior = prerequisites();
  for (const [path, hash] of prior) if (!delta.has(path) && SQLite安全指纹(root, path) !== hash) throw Error('分片存储前置不完整或未知改动：' + path);
  for (const item of 媒体启动器依赖()) if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('分片存储启动器依赖不完整或未知改动：' + item.文件);
  let before = 0, after = 0;
  for (const item of manifest.文件) {
    const hash = SQLite安全指纹(root, item.文件);
    if (hash === item.原始SHA256) before++;
    else if (hash === item.候选SHA256) after++;
    else throw Error('分片存储批次存在未知改动：' + item.文件);
  }
  if (before && after) throw Error('分片存储4文件批次不完整');
  exactTree(root, 'web/src/guan/sqlite', new Set([...prior.keys()].filter(path => path.startsWith('web/src/guan/sqlite/')).concat(paths)));
  exactTree(root, '扩展功能', new Set([媒体启动器路径, ...媒体启动器依赖().map(item => item.文件)]));
  return after === 4;
}
