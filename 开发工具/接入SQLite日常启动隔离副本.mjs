import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 配置合并源码指纹, 读取配置合并复验记录 } from './接入SQLite配置合并隔离副本.mjs';
import { 构建日常启动候选 } from './预审SQLite日常启动.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取日常启动批准, 日常启动差异SHA256, 日常启动前置指纹, 检查日常启动后继, 核验日常启动自有依赖 } from '../上游适配/SQLite日常启动批准.mjs';
import { SQLite安全指纹 } from '../上游适配/SQLite全面替换批准.mjs';

const excluded = new Set(['node_modules', '.git', 'dist', '.DS_Store', 'tsconfig.tsbuildinfo']);
export function 核验日常启动完整源码(root, after) {
  if (检查日常启动后继(root) !== after) throw Error('日常启动批次状态不符');
  const expected = 配置合并源码指纹(运行目录), actual = 配置合并源码指纹(root);
  for (const [path, hash] of 日常启动前置指纹()) expected.set(path, hash);
  if (after) for (const item of 读取日常启动批准().文件) expected.set(item.文件, item.候选SHA256);
  if (actual.size !== expected.size || [...expected].some(([path, hash]) => actual.get(path) !== hash)) throw Error('日常启动完整源码偏离日常基线和批准后继');
  return true;
}
export function 日常启动批准产物(reviewRecord) {
  const manifest = 读取日常启动批准(); 核验日常启动自有依赖(根目录);
  const preview = 构建日常启动候选(reviewRecord), delta = preview.delta;
  if (delta.size !== 3 || 哈希(生成审查差异(delta)) !== 日常启动差异SHA256) throw Error('日常启动重建差异不符');
  for (const item of manifest.文件) {
    const value = delta.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('日常启动产物指纹不符');
  }
  return preview;
}
export function 建立SQLite日常启动隔离副本(reviewRecord) {
  检查运行副本();
  const { integration: previous, delta } = 日常启动批准产物(reviewRecord);
  const home = mkdtempSync(join(根目录, '.运行/SQLite日常启动-')), root = join(home, '副本'); mkdirSync(root, { mode: 0o700 });
  function copy(path = '') {
    for (const name of readdirSync(join(previous.副本, path))) {
      if (excluded.has(name)) continue;
      const relative = path ? path + '/' + name : name, source = join(previous.副本, relative), target = join(root, relative), stat = lstatSync(source);
      if (stat.isSymbolicLink()) throw Error('日常启动复制拒绝链接');
      if (stat.isDirectory()) { mkdirSync(target); copy(relative); }
      else { if (!stat.isFile() || stat.nlink !== 1) throw Error('日常启动复制类型不安全'); cpSync(source, target, { force: false, errorOnExist: true }); }
    }
  }
  copy(); symlinkSync(join(运行目录, 'web/node_modules'), join(root, 'web/node_modules'));
  核验日常启动完整源码(root, false);
  const snapshot = join(home, '日常启动事务快照');
  事务写入(root, delta, snapshot, { 差异指纹: 日常启动差异SHA256, 写后检查() { 核验日常启动完整源码(root, true); 核验日常启动自有依赖(根目录); } });
  读取配置合并复验记录(reviewRecord); 检查运行副本();
  const report = { ...previous, 副本: root, 前置配置合并记录: resolve(reviewRecord), 日常启动差异SHA256,
    日常启动已完成: true, 日常启动文件数: 3, 日常启动事务快照: snapshot, 已接管3100: false, 已访问Keychain: false };
  writeFileSync(join(home, '日常启动接入记录.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}
export function 读取日常启动复验记录(path) {
  const record = resolve(path), home = dirname(record), root = join(home, '副本');
  if (!home.startsWith(resolve(根目录, '.运行') + sep) || !/^SQLite日常启动-[A-Za-z0-9]+$/.test(home.split(sep).at(-1)) ||
    record !== join(home, '日常启动接入记录.json') || realpathSync(record) !== record || realpathSync(root) !== root || !lstatSync(record).isFile() || lstatSync(record).nlink !== 1) throw Error('只允许日常启动隔离记录，不接受生产路径或链接');
  const integration = JSON.parse(readFileSync(record));
  if (integration.副本 !== root || integration.日常启动差异SHA256 !== 日常启动差异SHA256 || integration.日常启动已完成 !== true || integration.日常启动文件数 !== 3 ||
    integration.已接管3100 !== false || integration.已访问Keychain !== false || integration.日常启动事务快照 !== join(home, '日常启动事务快照')) throw Error('日常启动记录不完整');
  if (!SQLite安全指纹(home, '日常启动事务快照/事务.json')) throw Error('日常启动事务证据缺失');
  const journal = JSON.parse(readFileSync(join(integration.日常启动事务快照, '事务.json')));
  const manifest = 读取日常启动批准();
  if (journal.状态 !== '完成' || journal.差异SHA256 !== 日常启动差异SHA256 || journal.文件?.length !== 3 ||
    journal.文件.some((item, i) => item.路径 !== manifest.文件[i].文件 || item.原始SHA256 !== manifest.文件[i].原始SHA256 || item.产物SHA256 !== manifest.文件[i].候选SHA256)) throw Error('日常启动事务证据不完整');
  for (const item of manifest.文件) if (SQLite安全指纹(home, '日常启动事务快照/接入前/' + item.文件) !== item.原始SHA256) throw Error('日常启动事务原态快照不符');
  读取配置合并复验记录(integration.前置配置合并记录);
  核验日常启动自有依赖(根目录); 核验日常启动完整源码(root, true);
  return integration;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || !process.argv[2].startsWith('--配置合并前置记录=')) throw Error('仅允许核验配置合并前置并创建全新日常启动隔离副本');
  console.log(JSON.stringify(建立SQLite日常启动隔离副本(process.argv[2].slice('--配置合并前置记录='.length)), null, 2));
}
