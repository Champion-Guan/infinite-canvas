import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 读取凭据隔离复验记录 } from './SQLite凭据原画布夹具.mjs';
import { 构建配置合并候选 } from './预审SQLite配置合并保存.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取配置合并批准, 配置合并差异SHA256, 配置合并前置指纹, 检查配置合并后继, 核验配置合并自有依赖 } from '../上游适配/SQLite配置合并批准.mjs';

const excluded = new Set(['node_modules', '.git', 'dist', '.DS_Store', 'tsconfig.tsbuildinfo']);
export function 配置合并源码指纹(root) {
  const result = new Map();
  function walk(path = '') {
    for (const name of readdirSync(join(root, path))) {
      if (excluded.has(name)) continue;
      const relative = path ? path + '/' + name : name, stat = lstatSync(join(root, relative));
      if (stat.isSymbolicLink()) throw Error('配置合并完整源码拒绝链接');
      if (stat.isDirectory()) walk(relative);
      else if (!stat.isFile() || stat.nlink !== 1) throw Error('配置合并完整源码类型不安全');
      else result.set(relative, 哈希(readFileSync(join(root, relative))));
    }
  }
  walk(); return result;
}
export function 核验配置合并完整源码(root, after) {
  if (检查配置合并后继(root) !== after) throw Error('配置合并批次状态不符');
  const expected = 配置合并源码指纹(运行目录), actual = 配置合并源码指纹(root);
  for (const [path, hash] of 配置合并前置指纹()) expected.set(path, hash);
  if (after) for (const item of 读取配置合并批准().文件) expected.set(item.文件, item.候选SHA256);
  if (actual.size !== expected.size || [...expected].some(([path, hash]) => actual.get(path) !== hash)) throw Error('配置合并完整源码偏离日常基线和批准后继');
  return true;
}
export function 配置合并批准产物() {
  const manifest = 读取配置合并批准(); 核验配置合并自有依赖(根目录);
  const delta = 构建配置合并候选();
  if (delta.size !== 1 || 哈希(生成审查差异(delta)) !== 配置合并差异SHA256) throw Error('配置合并重建差异不符');
  for (const item of manifest.文件) {
    const value = delta.get(item.文件);
    if (!value || 哈希(value.原文) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('配置合并产物指纹不符');
  }
  return delta;
}
// 只复制核验过的10文件隔离源码；不复制数据库、浏览器、授权或旧构建产物。
export function 建立SQLite配置合并隔离副本(reviewRecord) {
  检查运行副本();
  const previous = 读取凭据隔离复验记录(reviewRecord), delta = 配置合并批准产物();
  const home = mkdtempSync(join(根目录, '.运行/SQLite配置合并-')), root = join(home, '副本'); mkdirSync(root, { mode: 0o700 });
  function copy(path = '') {
    for (const name of readdirSync(join(previous.副本, path))) {
      if (excluded.has(name)) continue;
      const relative = path ? path + '/' + name : name, source = join(previous.副本, relative), target = join(root, relative), stat = lstatSync(source);
      if (stat.isSymbolicLink()) throw Error('配置合并复制拒绝链接');
      if (stat.isDirectory()) { mkdirSync(target); copy(relative); }
      else { if (!stat.isFile() || stat.nlink !== 1) throw Error('配置合并复制类型不安全'); cpSync(source, target, { force: false, errorOnExist: true }); }
    }
  }
  copy(); symlinkSync(join(运行目录, 'web/node_modules'), join(root, 'web/node_modules'));
  核验配置合并完整源码(root, false);
  const snapshot = join(home, '配置合并事务快照');
  事务写入(root, delta, snapshot, { 差异指纹: 配置合并差异SHA256, 写后检查() { 核验配置合并完整源码(root, true); 核验配置合并自有依赖(根目录); } });
  读取凭据隔离复验记录(reviewRecord); 检查运行副本();
  const report = { ...previous, 副本: root, 前置凭据记录: resolve(reviewRecord), 配置合并差异SHA256, 配置合并已完成: true, 配置合并文件数: 1, 配置合并事务快照: snapshot, 已接管3100: false, 已访问Keychain: false };
  writeFileSync(join(home, '配置合并接入记录.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}
export function 读取配置合并复验记录(path) {
  检查运行副本();
  const record = resolve(path), home = dirname(record), root = join(home, '副本');
  if (!home.startsWith(resolve(根目录, '.运行') + sep) || !/^SQLite配置合并-[A-Za-z0-9]+$/.test(home.split(sep).at(-1)) ||
    record !== join(home, '配置合并接入记录.json') || realpathSync(record) !== record || realpathSync(root) !== root || !lstatSync(record).isFile() || lstatSync(record).nlink !== 1) throw Error('只允许配置合并隔离记录，不接受生产路径或链接');
  const integration = JSON.parse(readFileSync(record));
  if (integration.副本 !== root || integration.配置合并差异SHA256 !== 配置合并差异SHA256 || !integration.配置合并已完成 || integration.配置合并文件数 !== 1 || integration.已接管3100 !== false) throw Error('配置合并记录不完整');
  核验配置合并自有依赖(根目录); 核验配置合并完整源码(root, true);
  return integration;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || !process.argv[2].startsWith('--凭据前置记录=')) throw Error('仅允许核验凭据前置并创建全新配置合并隔离副本');
  console.log(JSON.stringify(建立SQLite配置合并隔离副本(process.argv[2].slice('--凭据前置记录='.length)), null, 2));
}
