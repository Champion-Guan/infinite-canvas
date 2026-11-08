import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';
import { 配置合并前置指纹, 读取配置合并批准, 核验配置合并自有依赖, 配置合并差异SHA256 } from './SQLite配置合并批准.mjs';

// 用户单独批准的3文件后继，历史审查字节和保护器保持不变。
export const 日常启动差异SHA256 = 'c5542c35527de84e4ef1222631aadd30d5cb8fc5e8ecf89c13d5c4fb615d363a';
export const 日常启动清单SHA256 = 'fe85235e0c03f04ffe248fb3146f0503211bb8b83ff3a2d46778a95c7b56add9';
export const 日常启动文件 = [
  ['扩展功能/本机服务/受限工作台启动器.mjs', '761f9ee369b87dada644769d348a56a5ff95593116d5bd0b2f2e4c7b405eea29', '87def14798fee285a8b80d3a3be7023c9f8ede9eebefae18f4cac761de8bd2c6'],
  ['扩展功能/本机服务/日常数据根.mjs', null, '84f6a96123c6f0771be6e1c925f648c8efae09dc7912fcd18bd252b62cc16237'],
  ['扩展功能/本机服务/日常工作台.mjs', null, 'e5b5662b4fd591349a711f9a4895ecd061f85291205bde7c881b7949671e9056'],
].map(values => Object.freeze(values));
Object.freeze(日常启动文件);
const sha = value => createHash('sha256').update(value).digest('hex');
export function 日常启动前置指纹() {
  const expected = 配置合并前置指纹();
  for (const item of 读取配置合并批准().文件) expected.set(item.文件, item.候选SHA256);
  return expected;
}
export function 核验日常启动批准(json, patch) {
  if (sha(json) !== 日常启动清单SHA256 || sha(patch) !== 日常启动差异SHA256) throw Error('日常启动批准指纹不符');
  const manifest = JSON.parse(json), prior = 日常启动前置指纹();
  if (manifest.上游提交 !== '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc' || manifest.差异SHA256 !== 日常启动差异SHA256 ||
    manifest.前置配置合并差异SHA256 !== 配置合并差异SHA256 || manifest.文件?.length !== 3 ||
    manifest.文件.some((item, i) => item.文件 !== 日常启动文件[i][0] || item.原始SHA256 !== 日常启动文件[i][1] ||
      item.候选SHA256 !== 日常启动文件[i][2] || item.原始SHA256 !== (prior.get(item.文件) ?? null))) throw Error('日常启动批准范围或前置不符');
  return manifest;
}
export function 读取日常启动批准() {
  return 核验日常启动批准(readFileSync(new URL('./待审查/SQLite日常启动.json', import.meta.url)), readFileSync(new URL('./待审查/SQLite日常启动.patch', import.meta.url)));
}
export function 核验日常启动自有依赖(root) {
  核验配置合并自有依赖(root);
  for (const [path, , hash] of 日常启动文件.slice(1)) if (SQLite安全指纹(root, path) !== hash) throw Error('日常启动自有来源未知改动：' + path);
}
export function 检查日常启动后继(root) {
  const manifest = 读取日常启动批准(), expected = 日常启动前置指纹();
  let before = 0, after = 0;
  for (const item of manifest.文件) {
    const current = SQLite安全指纹(root, item.文件);
    if (current === item.原始SHA256) before++;
    else if (current === item.候选SHA256) after++;
    else throw Error('日常启动批次未知改动：' + item.文件);
  }
  if (before && after) throw Error('日常启动3文件批次不完整');
  if (after === 3) for (const item of manifest.文件) expected.set(item.文件, item.候选SHA256);
  for (const [path, hash] of expected) if (SQLite安全指纹(root, path) !== hash) throw Error('日常启动历史前置未知改动：' + path);
  const directories = new Set();
  for (const file of expected.keys()) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  function walk(path) {
    const directory = lstatSync(join(root, path));
    if (directory.isSymbolicLink() || !directory.isDirectory()) throw Error('日常启动模块目录或链接不安全');
    for (const name of readdirSync(join(root, path))) {
      const relative = path + '/' + name, stat = lstatSync(join(root, relative));
      if (stat.isSymbolicLink()) throw Error('日常启动拒绝链接');
      if (stat.isDirectory() && directories.has(relative)) walk(relative);
      else if (!stat.isFile() || stat.nlink !== 1 || !expected.has(relative)) throw Error('日常启动模块存在未知文件、目录或链接');
    }
  }
  for (const path of ['web/src/guan/sqlite', '扩展功能']) walk(path);
  return after === 3;
}
