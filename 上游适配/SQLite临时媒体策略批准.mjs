import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQLite安全指纹 } from './SQLite全面替换批准.mjs';
import { 读取授权入口批准, 核验授权入口自有依赖, 授权入口差异SHA256 } from './SQLite工作台授权入口批准.mjs';
import { 服务包协议路径, 服务包协议SHA256 } from './SQLite写入协调批准.mjs';

// 2026-10-18用户批准单文件一行补丁；仅新隔离包，不重启或接管3100。
export const 媒体策略差异SHA256 = '73ff094f2387f9189c6ee415ebf31f16a9bc3845cb3d4ec1ec253b42493d9c0b';
export const 媒体策略清单SHA256 = '370d19b4a78df2c6b49089e2fc188e7fac376496035e8bd9ac59eecc130ad1df';
export const 媒体启动器路径 = '扩展功能/本机服务/受限工作台启动器.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
export function 核验媒体策略批准(json, patch) {
  if (sha(json) !== 媒体策略清单SHA256 || sha(patch) !== 媒体策略差异SHA256) throw Error('媒体策略批准指纹不符');
  const manifest = JSON.parse(json), parent = 读取授权入口批准().启动器来源.find(item => item.文件 === 媒体启动器路径);
  if (manifest.差异SHA256 !== 媒体策略差异SHA256 || manifest.前置授权入口差异SHA256 !== 授权入口差异SHA256 || manifest.文件.length !== 1 ||
    manifest.文件[0].文件 !== 媒体启动器路径 || manifest.文件[0].原始SHA256 !== parent?.SHA256) throw Error('媒体策略批准范围不符');
  return manifest;
}
export function 读取媒体策略批准() {
  return 核验媒体策略批准(readFileSync(new URL('./待审查/SQLite临时媒体策略.json', import.meta.url)), readFileSync(new URL('./待审查/SQLite临时媒体策略.patch', import.meta.url)));
}
export function 媒体启动器依赖() {
  return [...读取授权入口批准().启动器来源.filter(item => item.文件 !== 媒体启动器路径), { 文件: 服务包协议路径, SHA256: 服务包协议SHA256 }];
}
export function 核验媒体策略自有依赖(root) {
  核验授权入口自有依赖(root);
  for (const item of 媒体启动器依赖()) if (SQLite安全指纹(root, item.文件) !== item.SHA256) throw Error('媒体启动器自有依赖未知改动：' + item.文件);
}
export function 检查媒体启动器包(root) {
  const item = 读取媒体策略批准().文件[0], allowed = new Set([媒体启动器路径, ...媒体启动器依赖().map(item => item.文件)]);
  const directories = new Set(['扩展功能', '扩展功能/本机服务', '扩展功能/本机存储']);
  SQLite安全指纹(root, 媒体启动器路径);
  function walk(path = '') {
    for (const entry of readdirSync(join(root, path))) {
      const relative = path ? path + '/' + entry : entry, stat = lstatSync(join(root, relative));
      if (stat.isSymbolicLink()) throw Error('媒体启动器包不允许链接');
      if (stat.isDirectory() && directories.has(relative)) walk(relative);
      else if (!stat.isFile() || stat.nlink !== 1 || !allowed.has(relative)) throw Error('媒体启动器包出现未知文件、目录或硬链接');
    }
  }
  walk();
  for (const dependency of 媒体启动器依赖()) if (SQLite安全指纹(root, dependency.文件) !== dependency.SHA256) throw Error('媒体启动器依赖不完整或未知改动');
  const current = SQLite安全指纹(root, 媒体启动器路径);
  if (current === item.原始SHA256) return false;
  if (current === item.候选SHA256) return true;
  throw Error('媒体启动器存在未知改动');
}
