import { cpSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 哈希, 检查运行副本, 运行目录 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取产品删除隔离记录 } from './接入产品悬浮删除隔离副本.mjs';
import { 恢复挂载前置记录 } from './预审产品恢复挂载竞态.mjs';
import { 构建产品恢复挂载复审候选 } from './复审产品恢复挂载竞态.mjs';
import { 读取恢复挂载批准, 核验恢复挂载来源, 恢复挂载差异SHA256, 恢复挂载清单SHA256 } from '../上游适配/产品恢复挂载批准.mjs';
import { SQLite安全指纹 } from '../上游适配/SQLite全面替换批准.mjs';

const mapped = path => '画布副本/' + path;
function inventory(root) {
  if (realpathSync(root) !== resolve(root) || !lstatSync(root).isDirectory()) throw Error('恢复挂载根不是独立目录');
  const result = new Map();
  function walk(path = '') {
    for (const name of readdirSync(join(root, path))) {
      const relative = path ? path + '/' + name : name, file = join(root, relative), stat = lstatSync(file);
      if (relative === '画布副本/web/node_modules') {
        if (!stat.isSymbolicLink() || realpathSync(file) !== realpathSync(join(运行目录, 'web/node_modules'))) throw Error('恢复挂载依赖链接不符');
        result.set(relative, 'approved-dependencies'); continue;
      }
      if (stat.isSymbolicLink()) throw Error('恢复挂载拒绝源码链接');
      if (stat.isDirectory()) { result.set(relative, 'directory'); walk(relative); }
      else if (!stat.isFile() || stat.nlink !== 1) throw Error('恢复挂载拒绝特殊文件或硬链接');
      else result.set(relative, 哈希(readFileSync(file)));
    }
  }
  walk(); return result;
}
function expectedBefore() {
  const manifest = 读取恢复挂载批准(); 核验恢复挂载来源(根目录);
  if (manifest.前置记录 !== 恢复挂载前置记录) throw Error('恢复挂载前置路径不符');
  const previous = 读取产品删除隔离记录(恢复挂载前置记录);
  if (previous.差异SHA256 !== manifest.前置差异SHA256) throw Error('恢复挂载前置差异不符');
  const expected = inventory(previous.组合包);
  for (const item of manifest.文件)
    if ((expected.get(mapped(item.文件)) ?? null) !== item.原始SHA256) throw Error('恢复挂载前态不符：' + item.文件);
  return { expected, previous, manifest };
}
export function 核验恢复挂载完整包(root, after) {
  if (typeof after !== 'boolean') throw Error('恢复挂载必须明确完整前态或后态');
  const { expected, manifest } = expectedBefore(), actual = inventory(root);
  for (const item of manifest.文件) {
    const path = mapped(item.文件), current = actual.get(path) ?? null;
    if (![item.原始SHA256, item.候选SHA256].includes(current)) throw Error('恢复挂载文件未知改动：' + path);
    if (after) expected.set(path, item.候选SHA256);
    if (current !== (expected.get(path) ?? null)) throw Error('恢复挂载前后态错误：' + path);
  }
  if (actual.size !== expected.size || [...expected].some(([path, hash]) => actual.get(path) !== hash))
    throw Error('恢复挂载范围外源码、未知文件或目录改变');
  return true;
}
export function 恢复挂载批准产物() {
  const manifest = 读取恢复挂载批准(); 核验恢复挂载来源(根目录);
  const preview = 构建产品恢复挂载复审候选();
  if (preview.delta.size !== 3 || 哈希(生成审查差异(preview.delta)) !== 恢复挂载差异SHA256) throw Error('恢复挂载重建差异偏离批准');
  const result = new Map();
  for (const item of manifest.文件) {
    const value = preview.delta.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256)
      throw Error('恢复挂载重建产物偏离批准');
    result.set(mapped(item.文件), value);
  }
  return result;
}
export function 建立恢复挂载隔离副本() {
  检查运行副本();
  const { previous } = expectedBefore(), delta = 恢复挂载批准产物();
  const home = mkdtempSync(join(根目录, '.运行/产品恢复挂载-')), root = join(home, '组合包');
  cpSync(previous.组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true });
  核验恢复挂载完整包(root, false);
  const snapshot = join(home, '恢复挂载事务快照');
  事务写入(root, delta, snapshot, { 差异指纹: 恢复挂载差异SHA256, 写后检查() { 核验恢复挂载完整包(root, true); } });
  const report = { 组合包: root, 副本: join(root, '画布副本'), 服务包: join(root, '服务包'), 事务快照: snapshot,
    前置记录: 恢复挂载前置记录, 差异SHA256: 恢复挂载差异SHA256, 清单SHA256: 恢复挂载清单SHA256,
    文件数: 3, 已接入隔离副本: true, 已接管3100: false, 已访问Keychain: false };
  writeFileSync(join(home, '产品恢复挂载接入记录.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  检查运行副本(); return report;
}
export function 读取恢复挂载隔离记录(path) {
  const record = resolve(path), home = dirname(record), root = join(home, '组合包');
  if (!home.startsWith(resolve(根目录, '.运行') + sep) || !/^产品恢复挂载-[A-Za-z0-9]+$/.test(home.split(sep).at(-1)) ||
      record !== join(home, '产品恢复挂载接入记录.json') || realpathSync(record) !== record || !lstatSync(record).isFile() || lstatSync(record).nlink !== 1)
    throw Error('只接受产品恢复挂载隔离记录');
  const integration = JSON.parse(readFileSync(record)), manifest = 读取恢复挂载批准();
  if (integration.组合包 !== root || integration.副本 !== join(root, '画布副本') || integration.服务包 !== join(root, '服务包') ||
      integration.事务快照 !== join(home, '恢复挂载事务快照') || integration.前置记录 !== 恢复挂载前置记录 ||
      integration.差异SHA256 !== 恢复挂载差异SHA256 || integration.清单SHA256 !== 恢复挂载清单SHA256 || integration.文件数 !== 3 ||
      integration.已接入隔离副本 !== true || integration.已接管3100 !== false || integration.已访问Keychain !== false) throw Error('恢复挂载记录不完整');
  if (!SQLite安全指纹(home, '恢复挂载事务快照/事务.json')) throw Error('恢复挂载事务缺失');
  const journal = JSON.parse(readFileSync(join(integration.事务快照, '事务.json')));
  if (journal.上游提交 !== manifest.上游提交 || journal.状态 !== '完成' || journal.差异SHA256 !== 恢复挂载差异SHA256 || journal.文件?.length !== 3)
    throw Error('恢复挂载事务不完整');
  for (const [index, item] of manifest.文件.entries()) {
    const saved = journal.文件[index];
    if (saved.路径 !== mapped(item.文件) || saved.原始SHA256 !== item.原始SHA256 || saved.产物SHA256 !== item.候选SHA256 ||
        SQLite安全指纹(home, '恢复挂载事务快照/接入前/' + mapped(item.文件)) !== item.原始SHA256)
      throw Error('恢复挂载事务或原态快照不符');
  }
  核验恢复挂载完整包(root, true); return integration;
}
export async function 加载恢复挂载磁盘服务(integration) {
  if (integration.服务包 !== join(integration.组合包, '服务包') || integration.副本 !== join(integration.组合包, '画布副本')) throw Error('恢复挂载服务映射不符');
  核验恢复挂载完整包(integration.组合包, true);
  const modules = await Promise.all(['扩展功能/本机服务/数据服务.mjs', '扩展功能/本机存储/SQLite工作区.mjs'].map(path => import(pathToFileURL(join(integration.服务包, path)).href)));
  核验恢复挂载完整包(integration.组合包, true); return Object.assign({}, ...modules);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--应用已批准三文件复审到新隔离副本') throw Error('仅允许恢复挂载复审新隔离接入');
  console.log(JSON.stringify(建立恢复挂载隔离副本(), null, 2));
}
