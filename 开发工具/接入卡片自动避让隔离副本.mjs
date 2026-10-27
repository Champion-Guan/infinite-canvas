import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 读取日常启动复验记录 } from './接入SQLite日常启动隔离副本.mjs';
import { 配置合并源码指纹 } from './接入SQLite配置合并隔离副本.mjs';
import { 构建卡片自动避让候选, 卡片布局前置记录 } from './预审卡片自动避让.mjs';
import { 读取卡片布局批准, 核验卡片布局自有来源, 卡片布局差异SHA256, 卡片布局清单SHA256 } from '../上游适配/卡片自动避让批准.mjs';
import { SQLite安全指纹 } from '../上游适配/SQLite全面替换批准.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const excluded = new Set(['node_modules', '.git', 'dist', '.DS_Store', 'tsconfig.tsbuildinfo']);
// 新副本不接受未知的“dist/.git”等隐藏目录；唯一依赖链接必须指向已核验的共享依赖。
function 完整指纹(root) {
  if (realpathSync(root) !== resolve(root) || !lstatSync(root).isDirectory()) throw Error('卡片布局根路径不是独立目录');
  const files = new Map();
  function walk(path = '') {
    for (const name of readdirSync(join(root, path))) {
      const relative = path ? path + '/' + name : name, file = join(root, relative), stat = lstatSync(file);
      if (relative === 'web/node_modules') {
        if (!stat.isSymbolicLink() || realpathSync(file) !== realpathSync(join(运行目录, relative))) throw Error('卡片布局依赖链接不符');
        continue;
      }
      if (stat.isSymbolicLink()) throw Error('卡片布局拒绝源码链接');
      if (stat.isDirectory()) walk(relative);
      else if (!stat.isFile() || stat.nlink !== 1) throw Error('卡片布局拒绝特殊文件或硬链接');
      else files.set(relative, 哈希(readFileSync(file)));
    }
  }
  walk(); return files;
}
export function 核验卡片布局完整源码(root, after) {
  const manifest = 读取卡片布局批准();
  核验卡片布局自有来源(根目录);
  const previous = 读取日常启动复验记录(卡片布局前置记录);
  const expected = 配置合并源码指纹(previous.副本), actual = 完整指纹(root);
  let beforeCount = 0, afterCount = 0;
  for (const item of manifest.文件) {
    const current = actual.get(item.文件) ?? null;
    if (current === item.原始SHA256) beforeCount++;
    else if (current === item.候选SHA256) afterCount++;
    else throw Error('卡片布局批次未知改动：' + item.文件);
    if (item.原始SHA256 !== (expected.get(item.文件) ?? null)) throw Error('卡片布局批准前态与日常前置不符');
  }
  if (beforeCount && afterCount || (after ? afterCount !== 4 : beforeCount !== 4)) throw Error('卡片布局四文件半批或状态错误');
  if (after) for (const item of manifest.文件) expected.set(item.文件, item.候选SHA256);
  if (actual.size !== expected.size || [...expected].some(([path, hash]) => actual.get(path) !== hash)) throw Error('卡片布局范围外源码、未知文件或依赖发生改变');
  return true;
}
export function 建立卡片布局隔离副本() {
  检查运行副本();
  const manifest = 读取卡片布局批准(), preview = 构建卡片自动避让候选();
  核验卡片布局自有来源(根目录);
  if (preview.delta.size !== 4 || 哈希(生成审查差异(preview.delta)) !== 卡片布局差异SHA256) throw Error('卡片布局重建差异偏离批准');
  for (const item of manifest.文件) {
    const value = preview.delta.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('卡片布局产物指纹偏离批准');
  }
  const home = mkdtempSync(join(根目录, '.运行/卡片自动避让-')), root = join(home, '副本');
  mkdirSync(root, { mode: 0o700 });
  function copy(path = '') {
    for (const name of readdirSync(join(preview.integration.副本, path))) {
      if (excluded.has(name)) continue;
      const relative = path ? path + '/' + name : name, source = join(preview.integration.副本, relative), target = join(root, relative), stat = lstatSync(source);
      if (stat.isSymbolicLink()) throw Error('卡片布局复制拒绝链接');
      if (stat.isDirectory()) { mkdirSync(target); copy(relative); }
      else { if (!stat.isFile() || stat.nlink !== 1) throw Error('卡片布局复制类型不安全'); cpSync(source, target, { force: false, errorOnExist: true }); }
    }
  }
  copy(); symlinkSync(join(运行目录, 'web/node_modules'), join(root, 'web/node_modules'));
  核验卡片布局完整源码(root, false);
  const snapshot = join(home, '卡片布局事务快照');
  事务写入(root, preview.delta, snapshot, { 差异指纹: 卡片布局差异SHA256,
    写后检查() { 核验卡片布局完整源码(root, true); } });
  读取日常启动复验记录(卡片布局前置记录); 检查运行副本();
  const report = { 副本: root, 前置记录: 卡片布局前置记录, 差异SHA256: 卡片布局差异SHA256, 清单SHA256: 卡片布局清单SHA256,
    事务快照: snapshot, 文件数: 4, 已接入隔离副本: true, 已接管3100: false, 已访问Keychain: false };
  writeFileSync(join(home, '卡片布局接入记录.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}
export function 读取卡片布局隔离记录(path) {
  const record = resolve(path), home = dirname(record), root = join(home, '副本');
  if (!home.startsWith(resolve(根目录, '.运行') + sep) || !/^卡片自动避让-[A-Za-z0-9]+$/.test(home.split(sep).at(-1)) ||
    record !== join(home, '卡片布局接入记录.json') || realpathSync(record) !== record || !lstatSync(record).isFile() || lstatSync(record).nlink !== 1) throw Error('只允许卡片布局隔离记录，不接受生产路径或链接');
  const integration = JSON.parse(readFileSync(record)), manifest = 读取卡片布局批准();
  if (integration.副本 !== root || integration.前置记录 !== 卡片布局前置记录 || integration.差异SHA256 !== 卡片布局差异SHA256 ||
    integration.清单SHA256 !== 卡片布局清单SHA256 || integration.文件数 !== 4 || integration.已接入隔离副本 !== true ||
    integration.已接管3100 !== false || integration.已访问Keychain !== false || integration.事务快照 !== join(home, '卡片布局事务快照')) throw Error('卡片布局隔离记录不完整');
  if (!SQLite安全指纹(home, '卡片布局事务快照/事务.json')) throw Error('卡片布局事务证据缺失');
  const journal = JSON.parse(readFileSync(join(integration.事务快照, '事务.json')));
  if (journal.状态 !== '完成' || journal.差异SHA256 !== 卡片布局差异SHA256 || journal.文件?.length !== 4 ||
    journal.文件.some((item, i) => item.路径 !== manifest.文件[i].文件 || item.原始SHA256 !== manifest.文件[i].原始SHA256 ||
      item.产物SHA256 !== manifest.文件[i].候选SHA256)) throw Error('卡片布局事务证据不符');
  for (const item of manifest.文件) if (SQLite安全指纹(home, '卡片布局事务快照/接入前/' + item.文件) !== item.原始SHA256) throw Error('卡片布局原态快照不符');
  核验卡片布局完整源码(root, true);
  return integration;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--应用已批准四文件到新隔离副本') throw Error('仅允许全新隔离事务接入，不提供3100操作');
  console.log(JSON.stringify(建立卡片布局隔离副本(), null, 2));
}
