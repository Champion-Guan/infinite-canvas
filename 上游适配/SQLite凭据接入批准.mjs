import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQLite安全指纹, 读取SQLite批准 } from './SQLite全面替换批准.mjs';
import { 读取节点存储批准 } from './SQLite节点存储批准.mjs';
import { 读取启动存储批准 } from './SQLite启动存储批准.mjs';
import { 读取授权入口批准 } from './SQLite工作台授权入口批准.mjs';
import { 媒体启动器路径, 媒体启动器依赖 } from './SQLite临时媒体策略批准.mjs';
import { 读取免填码批准 } from './SQLite免填码启动批准.mjs';
import { 读取保存恢复批准 } from './SQLite保存恢复批准.mjs';
import { 读取分片存储批准, 核验分片存储自有依赖, 分片存储差异SHA256 } from './SQLite分片存储批准.mjs';

// 2026-10-18用户明确批准10文件，仅新隔离副本；不覆盖任何历史审批或保护器。
export const 凭据接入差异SHA256 = '8560ad712498bd2764d7fa49a1d0a94b18e288efbe2e347e9242f2e22ef217e6';
export const 凭据接入清单SHA256 = '51df6210fdd5a7f96ffcb26a8596ee973355258a71c00c139b66cfe2d5333e10';
const sha = value => createHash('sha256').update(value).digest('hex');
const paths = [媒体启动器路径, '扩展功能/本机服务/本机授权网关.mjs', 'web/src/guan/sqlite/本机授权客户端.mjs',
  'web/src/guan/sqlite/工作台自动入口.mjs', 'web/src/guan/sqlite/凭据协议.mjs', 'web/src/guan/sqlite/凭据客户端.mjs',
  ...['凭据协议.mjs', 'SQLite凭据保管.mjs', '钥匙串主密钥.mjs', '系统钥匙串.swift'].map(name => '扩展功能/本机凭据/' + name)];
export function 凭据接入前置指纹() {
  const prior = new Map(媒体启动器依赖().map(item => [item.文件, item.SHA256]));
  for (const batch of [读取SQLite批准(), 读取节点存储批准(), 读取启动存储批准(), 读取授权入口批准(), 读取免填码批准(), 读取保存恢复批准(), 读取分片存储批准()]) {
    for (const item of batch.文件) prior.set(item.文件, item.候选SHA256);
  }
  return prior;
}
export function 核验凭据接入批准(json, patch) {
  if (sha(json) !== 凭据接入清单SHA256 || sha(patch) !== 凭据接入差异SHA256) throw Error('凭据接入批准指纹不符');
  const manifest = JSON.parse(json), prior = 凭据接入前置指纹();
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 凭据接入差异SHA256 ||
    manifest.前置分片差异SHA256 !== 分片存储差异SHA256 || manifest.文件.length !== 10 ||
    manifest.文件.some((item, index) => item.文件 !== paths[index] || item.原始SHA256 !== (prior.get(item.文件) ?? null))) throw Error('凭据接入批准范围或前置不符');
  return manifest;
}
export function 读取凭据接入批准() {
  return 核验凭据接入批准(readFileSync(new URL('./待审查/SQLite凭据接入.json', import.meta.url)), readFileSync(new URL('./待审查/SQLite凭据接入.patch', import.meta.url)));
}
export function 核验凭据接入自有依赖(root) {
  核验分片存储自有依赖(root);
  for (const item of 读取凭据接入批准().文件.filter(item => item.文件.startsWith('扩展功能/本机凭据/'))) {
    if (SQLite安全指纹(root, item.文件) !== item.候选SHA256) throw Error('凭据接入自有来源未知改动：' + item.文件);
  }
  if (SQLite安全指纹(root, '扩展功能/本机凭据/凭据客户端.mjs') !== '901f0adc3eac4941b242bbb1509e0c32fe2866f98d7e4ba827b7ee29299920a4') throw Error('凭据客户端自有来源未知改动');
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
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('凭据接入模块目录类型或链接不安全');
    for (const name of readdirSync(join(root, path))) {
      const relative = path + '/' + name, current = lstatSync(join(root, relative));
      if (current.isDirectory() && directories.has(relative)) walk(relative);
      else if (!current.isFile() || current.nlink !== 1 || !files.has(relative)) throw Error('凭据接入模块出现未知文件、目录或链接');
    }
  }
  walk(directory);
}
export function 检查凭据接入后继(root) {
  const manifest = 读取凭据接入批准(), delta = new Map(manifest.文件.map(item => [item.文件, item])), prior = 凭据接入前置指纹();
  for (const [path, hash] of prior) if (!delta.has(path) && SQLite安全指纹(root, path) !== hash) throw Error('凭据接入前置不完整或未知改动：' + path);
  let before = 0, after = 0;
  for (const item of manifest.文件) {
    const hash = SQLite安全指纹(root, item.文件);
    if (hash === item.原始SHA256) before++;
    else if (hash === item.候选SHA256) after++;
    else throw Error('凭据接入批次存在未知改动：' + item.文件);
  }
  if (before && after) throw Error('凭据接入10文件批次不完整');
  const files = new Set([...prior.keys(), ...paths]);
  exactTree(root, 'web/src/guan/sqlite', new Set([...files].filter(path => path.startsWith('web/src/guan/sqlite/'))));
  exactTree(root, '扩展功能', new Set([...files].filter(path => path.startsWith('扩展功能/'))));
  return after === 10;
}
