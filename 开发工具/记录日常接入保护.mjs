import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { 根目录, 上游目录 } from './公共.mjs';
import { 哈希, 检查运行副本, 运行目录 } from './检查运行副本.mjs';
import { 配置合并源码指纹, 读取配置合并复验记录 } from './接入SQLite配置合并隔离副本.mjs';

function sources() {
  const files = {};
  function walk(path = '') {
    for (const name of readdirSync(join(根目录, path))) {
      if (['.git', '.运行', 'node_modules', '.DS_Store'].includes(name)) continue;
      const relative = path ? path + '/' + name : name, stat = lstatSync(join(根目录, relative));
      if (stat.isSymbolicLink()) throw Error('权威源码存在链接：' + relative);
      if (stat.isDirectory()) walk(relative);
      else files[relative] = 哈希(readFileSync(join(根目录, relative)));
    }
  }
  walk(); return files;
}
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
function protection() {
  检查运行副本();
  const previous = 读取配置合并复验记录('.运行/SQLite配置合并-CPXu7b/配置合并接入记录.json');
  return {
    upstreamHEAD: git(上游目录, 'rev-parse', 'HEAD').trim(), upstreamStatus: git(上游目录, 'status', '--porcelain=v1', '-uall'),
    dailySource: Object.fromEntries(配置合并源码指纹(运行目录)), prerequisiteSource: Object.fromEntries(配置合并源码指纹(previous.副本)),
    listener: execFileSync('lsof', ['-nP', '-iTCP:3100', '-sTCP:LISTEN'], { encoding: 'utf8' }),
  };
}
const option = process.argv[2];
if (process.argv.length !== 3) throw Error('必须明确开始或指定本轮保护记录。');
if (option === '--开始') {
  mkdirSync(join(根目录, '.运行/output'), { recursive: true });
  const output = mkdtempSync(join(根目录, '.运行/output/SQLite日常启动批准接入-'));
  const report = { output, date: new Date().toISOString(), protection: protection(), sources: sources(),
    gitStatus: git(根目录, '-c', 'core.quotepath=false', 'status', '--short', '--branch', '-uall') };
  writeFileSync(join(output, '开始保护.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(output);
} else if (option.startsWith('--结束=')) {
  const output = resolve(option.slice('--结束='.length));
  if (!output.startsWith(join(根目录, '.运行/output/SQLite日常启动批准接入-'))) throw Error('保护记录路径不符');
  const before = JSON.parse(readFileSync(join(output, '开始保护.json'))), after = sources(), current = protection();
  const added = Object.keys(after).filter(path => !(path in before.sources));
  const removed = Object.keys(before.sources).filter(path => !(path in after));
  const changed = Object.keys(before.sources).filter(path => path in after && before.sources[path] !== after[path]);
  const unchanged = JSON.stringify(current) === JSON.stringify(before.protection);
  const report = { unchanged, beforeCount: Object.keys(before.sources).length, afterCount: Object.keys(after).length, added, changed, removed,
    protection: current, gitStatus: git(根目录, '-c', 'core.quotepath=false', 'status', '--short', '--branch', '-uall') };
  writeFileSync(join(output, '结束保护.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...report, protection: undefined, gitStatus: undefined }, null, 2));
  if (!unchanged || removed.length) process.exitCode = 1;
} else throw Error('未知保护操作');
