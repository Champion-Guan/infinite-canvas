import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQLite安全指纹, 读取SQLite批准 } from './SQLite全面替换批准.mjs';
import { 读取节点存储批准 } from './SQLite节点存储批准.mjs';
import { 读取启动存储批准 } from './SQLite启动存储批准.mjs';
import { 读取授权入口批准, 核验授权入口自有依赖, 授权入口差异SHA256 } from './SQLite工作台授权入口批准.mjs';
import { 读取媒体策略批准, 媒体策略差异SHA256, 媒体启动器路径, 媒体启动器依赖 } from './SQLite临时媒体策略批准.mjs';

// 用户于2026-10-18批准精确3文件后继。历史检查器、审查快照和原启动器不变。
// 只在新隔离副本事务装配，不授权日常3100接管、旧数据迁入或发布。
export const 免填码差异SHA256 = 'f38d168aba5fc8b2eadce6c1e0aff3743f02cd66a05fc6cc639551b222cee74f';
export const 免填码清单SHA256 = 'cc63435d3261d8c5de2cd0e917e8b6bcc97e9897724fe97425e1e1fb08737b77';
const sha = value => createHash('sha256').update(value).digest('hex');
const boot = 'web/src/guan/sqlite/启动工作台.mjs', entry = 'web/src/guan/sqlite/工作台自动入口.mjs';
const paths = [媒体启动器路径, boot, entry];
export function 核验免填码批准(json, patch) {
  if (sha(json) !== 免填码清单SHA256 || sha(patch) !== 免填码差异SHA256) throw Error('免填码批准指纹不符');
  const manifest = JSON.parse(json), parent = 读取授权入口批准(), media = 读取媒体策略批准();
  const before = [media.文件[0].候选SHA256, parent.文件.find(item => item.文件 === boot).候选SHA256, null];
  if (manifest.差异SHA256 !== 免填码差异SHA256 || manifest.前置授权入口差异SHA256 !== 授权入口差异SHA256 ||
    manifest.前置媒体策略差异SHA256 !== 媒体策略差异SHA256 || manifest.文件.length !== 3 ||
    manifest.文件.some((item, index) => item.文件 !== paths[index] || item.原始SHA256 !== before[index]) ||
    JSON.stringify(manifest.启动器依赖) !== JSON.stringify(媒体启动器依赖())) throw Error('免填码批准范围或前置不符');
  return manifest;
}
export function 读取免填码批准() {
  return 核验免填码批准(readFileSync(new URL('./待审查/SQLite免填码启动.json', import.meta.url)), readFileSync(new URL('./待审查/SQLite免填码启动.patch', import.meta.url)));
}
export function 核验免填码自有依赖(root) {
  核验授权入口自有依赖(root);
  for (const item of 媒体启动器依赖()) if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('免填码启动器自有依赖未知改动：' + item.文件);
  for (const [source, target] of [['扩展功能/本机存储/自动启动工作台.mjs', boot], ['扩展功能/本机存储/工作台自动入口.mjs', entry]]) {
    if (SQLite安全指纹(root, source) !== 读取免填码批准().文件.find(item => item.文件 === target).候选SHA256) throw Error('免填码入口自有来源未知改动：' + source);
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
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('免填码模块目录类型或链接不安全');
    for (const name of readdirSync(join(root, path))) {
      const relative = path + '/' + name, current = lstatSync(join(root, relative));
      if (current.isDirectory() && directories.has(relative)) walk(relative);
      else if (!current.isFile() || current.nlink !== 1 || !files.has(relative)) throw Error('免填码模块出现未知文件、目录或链接');
    }
  }
  walk(directory);
}
// 独立核验全部前置及3文件全前/全后态，不能放宽历史9文件和媒体保护器。
export function 检查免填码后继(root) {
  const manifest = 读取免填码批准(), delta = new Map(manifest.文件.map(item => [item.文件, item]));
  const prerequisite = new Map();
  for (const batch of [读取SQLite批准(), 读取节点存储批准(), 读取启动存储批准(), 读取授权入口批准()]) {
    for (const item of batch.文件) prerequisite.set(item.文件, item.候选SHA256);
  }
  for (const [path, hash] of prerequisite) if (!delta.has(path) && SQLite安全指纹(root, path) !== hash) throw Error('免填码前置不完整或未知改动：' + path);
  for (const item of 媒体启动器依赖()) if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('免填码启动器依赖不完整或未知改动：' + item.文件);
  let before = 0, after = 0;
  for (const item of manifest.文件) {
    const hash = SQLite安全指纹(root, item.文件);
    if (hash === item.原始SHA256) before++;
    else if (hash === item.候选SHA256) after++;
    else throw Error('免填码批次存在未知改动：' + item.文件);
  }
  if (before && after) throw Error('免填码3文件批次不完整');
  exactTree(root, 'web/src/guan/sqlite', new Set([...读取授权入口批准().文件.map(item => item.文件).filter(path => path !== 'web/index.html'), entry]));
  exactTree(root, '扩展功能', new Set([媒体启动器路径, ...媒体启动器依赖().map(item => item.文件)]));
  return after === 3;
}
