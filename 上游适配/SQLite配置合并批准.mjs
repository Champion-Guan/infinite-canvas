import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';
import { 凭据接入前置指纹, 读取凭据接入批准, 凭据接入差异SHA256, 核验凭据接入自有依赖 } from './SQLite凭据接入批准.mjs';

// 2026-10-18单独批准的1文件后继，不放宽历史保护器，不改历史审查字节。
export const 配置合并差异SHA256 = '7a9afa2549993c6ea13d98f6d1574612a3e242ed16da01136c0b1cf4b5de2acd';
export const 配置合并清单SHA256 = 'd20c0724c5d64754c90cfea4c46fef9eeaed75e6b413ba3c4d0306969455b74e';
export const 配置合并路径 = 'web/src/stores/use-config-store.ts';
const sha = value => createHash('sha256').update(value).digest('hex');
const 历史审批路径 = ['SQLite全面替换', 'SQLite节点存储惰性接入', 'SQLite启动存储隔离', 'SQLite工作台授权入口复审', 'SQLite临时媒体策略', 'SQLite免填码启动', 'SQLite保存恢复', 'SQLite分片存储', 'SQLite凭据接入']
  .flatMap(name => ['json', 'patch'].map(ext => new URL('./待审查/' + name + '.' + ext, import.meta.url)));
let 前置缓存;
function 审批字节() { return 历史审批路径.map(path => readFileSync(path)); }
function 相同审批(a, b) { return a.every((bytes, index) => bytes.equals(b[index])); }
export function 配置合并前置指纹() {
  // 先由全部历史批准器核验一次，随后每次逐字重读18份原审批。
  // 仅复用确定不变的Map，仍逐文件核验目标源码；审批漂移立即拒绝，不用旧缓存放行。
  const snapshot = 审批字节();
  if (前置缓存) {
    if (!相同审批(snapshot, 前置缓存.审批)) throw Error('配置合并历史审批字节发生改动');
    return new Map(前置缓存.文件);
  }
  const files = new Map(凭据接入前置指纹());
  for (const item of 读取凭据接入批准().文件) files.set(item.文件, item.候选SHA256);
  if (!相同审批(snapshot, 审批字节())) throw Error('配置合并历史审批在核验时发生改动');
  前置缓存 = { 审批: snapshot, 文件: new Map(files) }; return files;
}
export function 核验配置合并批准(json, patch) {
  if (sha(json) !== 配置合并清单SHA256 || sha(patch) !== 配置合并差异SHA256) throw Error('配置合并批准指纹不符');
  const manifest = JSON.parse(json), item = manifest.文件?.[0];
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.前置凭据差异SHA256 !== 凭据接入差异SHA256 ||
    manifest.差异SHA256 !== 配置合并差异SHA256 || manifest.文件.length !== 1 || item.文件 !== 配置合并路径 ||
    item.原始SHA256 !== 配置合并前置指纹().get(配置合并路径) || item.候选SHA256 !== '2ef75f078aa7b3539a87d421bf32268862ca42843f1599155125cf165660fad3') throw Error('配置合并批准范围或前置不符');
  return manifest;
}
export function 读取配置合并批准() {
  return 核验配置合并批准(readFileSync(new URL('./待审查/SQLite配置合并保存.json', import.meta.url)), readFileSync(new URL('./待审查/SQLite配置合并保存.patch', import.meta.url)));
}
export function 核验配置合并自有依赖(root) { 核验凭据接入自有依赖(root); }
export function 检查配置合并后继(root) {
  const item = 读取配置合并批准().文件[0], current = SQLite安全指纹(root, 配置合并路径);
  const after = current === item.候选SHA256;
  if (!after && current !== item.原始SHA256) throw Error('配置合并目标未知改动或缺失');
  const expected = 配置合并前置指纹(); expected.set(配置合并路径, after ? item.候选SHA256 : item.原始SHA256);
  for (const [path, hash] of expected) if (SQLite安全指纹(root, path) !== hash) throw Error('配置合并历史前置未知改动：' + path);
  const directories = new Set();
  for (const file of expected.keys()) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  function walk(path) {
    if (!lstatSync(join(root, path)).isDirectory()) throw Error('配置合并模块目录类型不安全');
    for (const name of readdirSync(join(root, path))) {
      const relative = path + '/' + name, stat = lstatSync(join(root, relative));
      if (stat.isSymbolicLink()) throw Error('配置合并拒绝链接');
      if (stat.isDirectory() && directories.has(relative)) walk(relative);
      else if (!stat.isFile() || stat.nlink !== 1 || !expected.has(relative)) throw Error('配置合并模块存在未知文件、目录或链接');
    }
  }
  for (const path of ['web/src/guan/sqlite', '扩展功能']) walk(path);
  return after;
}
