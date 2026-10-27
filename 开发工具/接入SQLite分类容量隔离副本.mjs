import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 构建分类容量候选, 分类容量前置记录, 分类容量服务前置 } from './预审SQLite分类容量.mjs';
import { 读取卡片布局隔离记录 } from './接入卡片自动避让隔离副本.mjs';
import { 检查写入协调服务包 } from '../上游适配/SQLite写入协调批准.mjs';
import { 分类容量差异SHA256, 分类容量清单SHA256, 分类容量组合路径, 读取分类容量批准, 核验分类容量来源 } from '../上游适配/SQLite分类容量批准.mjs';
import { SQLite安全指纹 } from '../上游适配/SQLite全面替换批准.mjs';

// 文件和目录都纳入清单，唯一允许的链接是已核验共享web依赖。
function inventory(root, dependencyPath) {
  if (realpathSync(root) !== resolve(root) || !lstatSync(root).isDirectory()) throw Error('分类容量根路径不是独立目录');
  const files = new Map();
  function walk(path = '') {
    for (const name of readdirSync(join(root, path))) {
      const relative = path ? path + '/' + name : name, file = join(root, relative), stat = lstatSync(file);
      if (relative === dependencyPath) {
        if (!stat.isSymbolicLink() || realpathSync(file) !== realpathSync(join(运行目录, 'web/node_modules'))) throw Error('分类容量依赖链接不符');
        files.set(relative, 'approved-dependencies'); continue;
      }
      if (stat.isSymbolicLink()) throw Error('分类容量拒绝源码链接');
      if (stat.isDirectory()) { files.set(relative, 'directory'); walk(relative); }
      else if (!stat.isFile() || stat.nlink !== 1) throw Error('分类容量拒绝特殊文件或硬链接');
      else files.set(relative, 哈希(readFileSync(file)));
    }
  }
  walk(); return files;
}
function expectedBefore() {
  const manifest = 读取分类容量批准(); 核验分类容量来源(根目录);
  if (manifest.前置记录 !== 分类容量前置记录 || manifest.服务前置 !== 分类容量服务前置) throw Error('分类容量前置路径不符');
  const previous = 读取卡片布局隔离记录(分类容量前置记录);
  if (!检查写入协调服务包(分类容量服务前置)) throw Error('分类容量服务前置未批准');
  const expected = new Map([['画布副本', 'directory'], ['服务包', 'directory']]);
  for (const [prefix, root, dependencies] of [['画布副本', previous.副本, 'web/node_modules'], ['服务包', 分类容量服务前置, undefined]])
    for (const [path, hash] of inventory(root, dependencies)) expected.set(prefix + '/' + path, hash);
  for (const item of manifest.文件)
    if ((expected.get(分类容量组合路径(item.文件)) ?? null) !== item.原始SHA256) throw Error('分类容量六文件前态不符');
  return { expected, previous, manifest };
}
export function 核验分类容量完整包(root, after) {
  const { expected, manifest } = expectedBefore(), actual = inventory(root, '画布副本/web/node_modules');
  let beforeCount = 0, afterCount = 0;
  for (const item of manifest.文件) {
    const path = 分类容量组合路径(item.文件), current = actual.get(path) ?? null;
    if (current === item.原始SHA256) beforeCount++;
    else if (current === item.候选SHA256) afterCount++;
    else throw Error('分类容量批次未知改动：' + path);
    if (after) expected.set(path, item.候选SHA256);
  }
  if (beforeCount && afterCount || (after ? afterCount !== 6 : beforeCount !== 6)) throw Error('分类容量六文件半批或状态错误');
  if (actual.size !== expected.size || [...expected].some(([path, hash]) => actual.get(path) !== hash)) throw Error('分类容量范围外源码、未知文件或目录改变');
  return true;
}
export function 分类容量批准产物() {
  const manifest = 读取分类容量批准(), preview = 构建分类容量候选(); 核验分类容量来源(根目录);
  if (preview.delta.size !== 6 || 哈希(生成审查差异(preview.delta)) !== 分类容量差异SHA256) throw Error('分类容量重建差异偏离批准');
  for (const item of manifest.文件) {
    const value = preview.delta.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('分类容量重建产物不符');
  }
  return new Map([...preview.delta].map(([path, value]) => [分类容量组合路径(path), value]));
}
export function 建立分类容量隔离副本() {
  检查运行副本();
  const { previous } = expectedBefore(), delta = 分类容量批准产物();
  const home = mkdtempSync(join(根目录, '.运行/SQLite分类容量-')), root = join(home, '组合包');
  mkdirSync(root, { mode: 0o700 });
  for (const [prefix, source] of [['画布副本', previous.副本], ['服务包', 分类容量服务前置]]) {
    // 原副本已通过完整前置保护，复制时不解引用唯一的依赖链接。
    cpSync(source, join(root, prefix), { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true });
  }
  核验分类容量完整包(root, false);
  const snapshot = join(home, '分类容量事务快照');
  事务写入(root, delta, snapshot, { 差异指纹: 分类容量差异SHA256, 写后检查() { 核验分类容量完整包(root, true); } });
  const report = { 组合包: root, 副本: join(root, '画布副本'), 服务包: join(root, '服务包'), 事务快照: snapshot,
    前置记录: 分类容量前置记录, 服务前置: 分类容量服务前置, 差异SHA256: 分类容量差异SHA256, 清单SHA256: 分类容量清单SHA256,
    文件数: 6, 已接入隔离副本: true, 已接管3100: false, 已访问Keychain: false };
  writeFileSync(join(home, '分类容量接入记录.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  检查运行副本(); return report;
}
export function 读取分类容量隔离记录(path) {
  const record = resolve(path), home = dirname(record), root = join(home, '组合包');
  if (!home.startsWith(resolve(根目录, '.运行') + sep) || !/^SQLite分类容量-[A-Za-z0-9]+$/.test(home.split(sep).at(-1)) ||
    record !== join(home, '分类容量接入记录.json') || realpathSync(record) !== record || !lstatSync(record).isFile() || lstatSync(record).nlink !== 1) throw Error('只接受分类容量隔离记录');
  const integration = JSON.parse(readFileSync(record)), manifest = 读取分类容量批准();
  if (integration.组合包 !== root || integration.副本 !== join(root, '画布副本') || integration.服务包 !== join(root, '服务包') ||
    integration.事务快照 !== join(home, '分类容量事务快照') || integration.前置记录 !== 分类容量前置记录 || integration.服务前置 !== 分类容量服务前置 ||
    integration.差异SHA256 !== 分类容量差异SHA256 || integration.清单SHA256 !== 分类容量清单SHA256 || integration.文件数 !== 6 ||
    integration.已接入隔离副本 !== true || integration.已接管3100 !== false || integration.已访问Keychain !== false) throw Error('分类容量记录不完整');
  if (!SQLite安全指纹(home, '分类容量事务快照/事务.json')) throw Error('分类容量事务证据缺失');
  const journal = JSON.parse(readFileSync(join(integration.事务快照, '事务.json')));
  if (journal.状态 !== '完成' || journal.差异SHA256 !== 分类容量差异SHA256 || journal.文件?.length !== 6 || journal.文件.some((item, i) =>
    item.路径 !== 分类容量组合路径(manifest.文件[i].文件) || item.原始SHA256 !== manifest.文件[i].原始SHA256 || item.产物SHA256 !== manifest.文件[i].候选SHA256)) throw Error('分类容量事务证据不符');
  for (const item of manifest.文件)
    if (SQLite安全指纹(home, '分类容量事务快照/接入前/' + 分类容量组合路径(item.文件)) !== item.原始SHA256) throw Error('分类容量原态快照不符');
  核验分类容量完整包(root, true); return integration;
}
export async function 加载分类容量磁盘服务(integration) {
  const serviceRoot = join(integration.组合包, '服务包');
  if (integration.服务包 !== serviceRoot || integration.副本 !== join(integration.组合包, '画布副本')) throw Error('分类容量服务路径映射不符');
  核验分类容量完整包(integration.组合包, true);
  const service = await import(pathToFileURL(join(serviceRoot, '扩展功能/本机服务/数据服务.mjs')).href);
  const workspace = await import(pathToFileURL(join(serviceRoot, '扩展功能/本机存储/SQLite工作区.mjs')).href);
  核验分类容量完整包(integration.组合包, true); return { ...service, ...workspace };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--应用已批准六文件到新隔离副本') throw Error('仅允许新隔离接入，不提供3100操作');
  console.log(JSON.stringify(建立分类容量隔离副本(), null, 2));
}
