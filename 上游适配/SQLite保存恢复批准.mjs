import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQLite安全指纹, 读取SQLite批准 } from './SQLite全面替换批准.mjs';
import { 读取节点存储批准 } from './SQLite节点存储批准.mjs';
import { 读取启动存储批准 } from './SQLite启动存储批准.mjs';
import { 读取授权入口批准 } from './SQLite工作台授权入口批准.mjs';
import { 媒体启动器路径, 媒体启动器依赖 } from './SQLite临时媒体策略批准.mjs';
import { 读取免填码批准, 核验免填码自有依赖, 免填码差异SHA256 } from './SQLite免填码启动批准.mjs';

// 2026-10-18用户批准精确5文件，仅新隔离副本；历史审批与保护器不变。
export const 保存恢复差异SHA256 = '3875ba9ebc2ae7ad8b0a3b993fb8f9f7b71ae89757e242c7d2eac888d1057f14';
export const 保存恢复清单SHA256 = '721f772399820f7d780733c5585bb9c900835aec3444a577f9d56ac31f4ddc3f';
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = ['web/src/guan/上游浏览器存储桥.ts', 'web/src/guan/SQLite应用入口.tsx', 'web/src/guan/sqlite/工作台自动入口.mjs', 'web/src/guan/sqlite/可恢复应用存储.mjs', 'web/src/guan/保存状态条.tsx'];
export function 核验保存恢复批准(json, patch) {
  if (sha(json) !== 保存恢复清单SHA256 || sha(patch) !== 保存恢复差异SHA256) throw Error('保存恢复批准指纹不符');
  const manifest = JSON.parse(json), prior = new Map();
  for (const batch of [读取SQLite批准(), 读取节点存储批准(), 读取启动存储批准(), 读取授权入口批准(), 读取免填码批准()]) {
    for (const item of batch.文件) prior.set(item.文件, item.候选SHA256);
  }
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 保存恢复差异SHA256 ||
    manifest.前置免填码差异SHA256 !== 免填码差异SHA256 || manifest.文件.length !== 5 ||
    manifest.文件.some((item, index) => item.文件 !== paths[index] || item.原始SHA256 !== (prior.get(item.文件) ?? null))) throw Error('保存恢复批准范围或前置不符');
  return manifest;
}
export function 读取保存恢复批准() {
  return 核验保存恢复批准(readFileSync(new URL('./待审查/SQLite保存恢复.json', import.meta.url)), readFileSync(new URL('./待审查/SQLite保存恢复.patch', import.meta.url)));
}
export function 核验保存恢复自有依赖(root) {
  核验免填码自有依赖(root);
  for (const [source, target] of [
    ['扩展功能/本机存储/保存恢复存储桥.ts', paths[0]],
    ['扩展功能/本机存储/可恢复应用存储.mjs', paths[3]],
    ['扩展功能/存储界面/保存状态条.tsx', paths[4]],
  ]) if (SQLite安全指纹(root, source) !== 读取保存恢复批准().文件.find(item => item.文件 === target).候选SHA256) throw Error('保存恢复自有来源未知改动：' + source);
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
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('保存恢复模块目录类型或链接不安全');
    for (const name of readdirSync(join(root, path))) {
      const relative = path + '/' + name, current = lstatSync(join(root, relative));
      if (current.isDirectory() && directories.has(relative)) walk(relative);
      else if (!current.isFile() || current.nlink !== 1 || !files.has(relative)) throw Error('保存恢复模块出现未知文件、目录或链接');
    }
  }
  walk(directory);
}
// 必须保留所有前置完整性；五文件只接受全前或全后，不允许跳过/半批。
export function 检查保存恢复后继(root) {
  const manifest = 读取保存恢复批准(), delta = new Map(manifest.文件.map(item => [item.文件, item])), prior = new Map();
  for (const batch of [读取SQLite批准(), 读取节点存储批准(), 读取启动存储批准(), 读取授权入口批准(), 读取免填码批准()]) {
    for (const item of batch.文件) prior.set(item.文件, item.候选SHA256);
  }
  for (const [path, hash] of prior) if (!delta.has(path) && SQLite安全指纹(root, path) !== hash) throw Error('保存恢复前置不完整或未知改动：' + path);
  for (const item of 媒体启动器依赖()) if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('保存恢复启动器依赖不完整或未知改动：' + item.文件);
  let before = 0, after = 0;
  for (const item of manifest.文件) {
    const hash = SQLite安全指纹(root, item.文件);
    if (hash === item.原始SHA256) before++;
    else if (hash === item.候选SHA256) after++;
    else throw Error('保存恢复批次存在未知改动：' + item.文件);
  }
  if (before && after) throw Error('保存恢复5文件批次不完整');
  exactTree(root, 'web/src/guan/sqlite', new Set([...读取授权入口批准().文件.map(item => item.文件).filter(path => path !== 'web/index.html'), paths[2], paths[3]]));
  exactTree(root, '扩展功能', new Set([媒体启动器路径, ...媒体启动器依赖().map(item => item.文件)]));
  return after === 5;
}
