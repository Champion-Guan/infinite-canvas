// 独立后继，迁自 开发工具/接入迁移扩大整批收尾隔离副本.mjs SHA256 185ed8632e3eae246e1b44d2ab3262a531070d10167f1b452b254a23943b35e0；原件保留。
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本, 运行目录 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取迁移扩大整批收尾隔离记录 } from './接入迁移扩大整批收尾隔离副本.mjs';
import { 构建任务确认与设置边界候选, 确认边界前置记录 } from './预审任务确认与设置边界.mjs';
import { 读取任务确认与设置边界批准, 核验任务确认与设置边界来源, 确认边界差异SHA256, 确认边界清单SHA256 } from '../上游适配/任务确认与设置边界批准.mjs';

function inventory(root) {
  if (realpathSync(root) !== resolve(root) || !lstatSync(root).isDirectory()) throw Error('确认边界根不是独立目录');
  const result = new Map();
  function walk(path = '') {
    for (const name of readdirSync(join(root, path))) {
      const relative = path ? path + '/' + name : name, file = join(root, relative), stat = lstatSync(file);
      if (relative === '画布副本/web/node_modules') {
        if (!stat.isSymbolicLink() || realpathSync(file) !== realpathSync(join(运行目录, 'web/node_modules'))) throw Error('确认边界依赖链接不符');
        result.set(relative, 'approved-dependencies'); continue;
      }
      if (stat.isSymbolicLink()) throw Error('确认边界拒绝源码链接');
      if (stat.isDirectory()) { result.set(relative, 'directory'); walk(relative); }
      else if (!stat.isFile() || stat.nlink !== 1) throw Error('确认边界拒绝特殊文件或硬链接');
      else result.set(relative, 哈希(readFileSync(file)));
    }
  }
  walk(); return result;
}
function addParents(map, path) {
  let parent = dirname(path);
  while (parent !== '.') { if (!map.has(parent)) map.set(parent, 'directory'); parent = dirname(parent); }
}
function equalInventory(actual, expected, message) {
  if (actual.size !== expected.size || [...expected].some(([path, value]) => actual.get(path) !== value)) throw Error(message);
}
function expectedBefore() {
  const manifest = 读取任务确认与设置边界批准(); 核验任务确认与设置边界来源(根目录);
  if (manifest.前置记录 !== 确认边界前置记录) throw Error('确认边界前置记录不符');
  const previous = 读取迁移扩大整批收尾隔离记录(确认边界前置记录);
  if (previous.差异SHA256 !== manifest.前置差异SHA256) throw Error('确认边界前置差异不符');
  const expected = inventory(previous.组合包);
  for (const item of manifest.文件) if ((expected.get(item.文件) ?? null) !== item.原始SHA256) throw Error('确认边界前态不符：' + item.文件);
  return { expected, previous, manifest };
}
export function 核验任务确认与设置边界完整包(root, after) {
  if (typeof after !== 'boolean') throw Error('确认边界必须明确完整前态或后态');
  const manifest = 读取任务确认与设置边界批准(), actual = inventory(root);
  for (const item of manifest.文件) if ((actual.get(item.文件) ?? null) !== (after ? item.候选SHA256 : item.原始SHA256)) throw Error('确认边界前后态错误：' + item.文件);
  const { expected } = expectedBefore();
  if (after) for (const item of manifest.文件) { expected.set(item.文件, item.候选SHA256); addParents(expected, item.文件); }
  equalInventory(actual, expected, '确认边界范围外源码、未知文件或目录改变'); return true;
}
export function 任务确认与设置边界批准产物() {
  const manifest = 读取任务确认与设置边界批准(); 核验任务确认与设置边界来源(根目录);
  const { delta } = 构建任务确认与设置边界候选();
  if (delta.size !== 9 || 哈希(生成审查差异(delta)) !== 确认边界差异SHA256) throw Error('确认边界重建差异偏离批准');
  for (const item of manifest.文件) {
    const value = delta.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('确认边界重建产物偏离批准');
  }
  return delta;
}
export function 任务确认与设置边界事务写入(root, delta, snapshot, hooks = {}) {
  核验任务确认与设置边界完整包(root, false);
  if (delta.size !== 9 || 哈希(生成审查差异(delta)) !== 确认边界差异SHA256) throw Error('事务只接受完整批准9文件');
  if (resolve(snapshot) !== snapshot || dirname(snapshot) !== dirname(resolve(root)) || realpathSync(dirname(snapshot)) !== dirname(snapshot) || existsSync(snapshot)) throw Error('确认边界事务快照必须全新且位于同一独立目录');
  const before = inventory(root), created = new Set();
  for (const [path] of delta) { let parent = dirname(path); while (parent !== '.') { if (!before.has(parent)) created.add(parent); parent = dirname(parent); } }
  try {
    return 事务写入(root, delta, snapshot, { ...hooks, 差异指纹: 确认边界差异SHA256,
      写后检查() { 核验任务确认与设置边界完整包(root, true); hooks.写后检查?.(); } });
  } catch (error) {
    const journal = join(snapshot, '事务.json');
    if (!existsSync(journal) || JSON.parse(readFileSync(journal)).状态 !== '已回退') throw error;
    for (const path of [...created].sort((a, b) => b.split('/').length - a.split('/').length)) {
      const file = join(root, path); if (!existsSync(file)) continue;
      if (!lstatSync(file).isDirectory() || realpathSync(file) !== resolve(file) || readdirSync(file).length) throw Error('确认边界回退目录含未知内容，保留现场', { cause: error });
      rmdirSync(file);
    }
    核验任务确认与设置边界完整包(root, false); throw error;
  }
}
export function 任务确认与设置边界记录内容(home) {
  const root = join(home, '组合包');
  return { 组合包: root, 副本: join(root, '画布副本'), 服务包: join(root, '服务包'), 事务快照: join(home, '确认边界事务快照'),
    前置记录: 确认边界前置记录, 差异SHA256: 确认边界差异SHA256, 清单SHA256: 确认边界清单SHA256,
    文件数: 9, 已接入隔离副本: true, 已接管3100: false, 已访问Keychain: false };
}
export function 读取任务确认与设置边界隔离记录(path) {
  const record = resolve(path), home = dirname(record);
  if (!home.startsWith(resolve(根目录, '.运行') + sep) || !/^任务确认与设置边界-[A-Za-z0-9]+$/.test(home.split(sep).at(-1)) || record !== join(home, '确认边界接入记录.json') ||
    realpathSync(record) !== record || !lstatSync(record).isFile() || lstatSync(record).nlink !== 1) throw Error('只接受确认边界隔离记录');
  const integration = JSON.parse(readFileSync(record)), expected = 任务确认与设置边界记录内容(home), manifest = 读取任务确认与设置边界批准();
  if (Object.keys(integration).sort().join(',') !== Object.keys(expected).sort().join(',') || Object.entries(expected).some(([key, value]) => integration[key] !== value)) throw Error('确认边界记录不完整');
  const journal = { 上游提交: 基线.提交, 差异SHA256: 确认边界差异SHA256, 状态: '完成', 文件: manifest.文件.map(item => ({ 路径: item.文件, 原始SHA256: item.原始SHA256, 产物SHA256: item.候选SHA256 })) };
  const snapshots = new Map([['事务.json', 哈希(JSON.stringify(journal, null, 2) + '\n')]]);
  for (const item of manifest.文件) {
    addParents(snapshots, '接入后/' + item.文件);
    if (item.原始SHA256 !== null) { const path = '接入前/' + item.文件; snapshots.set(path, item.原始SHA256); addParents(snapshots, path); }
  }
  equalInventory(inventory(integration.事务快照), snapshots, '确认边界事务、原态快照或未知快照内容不符');
  核验任务确认与设置边界完整包(integration.组合包, true); return integration;
}
export function 建立任务确认与设置边界隔离副本() {
  检查运行副本(); const { previous } = expectedBefore(), delta = 任务确认与设置边界批准产物();
  const home = mkdtempSync(join(根目录, '.运行/任务确认与设置边界-')), root = join(home, '组合包');
  cpSync(previous.组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true });
  const report = 任务确认与设置边界记录内容(home);
  任务确认与设置边界事务写入(root, delta, report.事务快照);
  writeFileSync(join(home, '确认边界接入记录.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  读取任务确认与设置边界隔离记录(join(home, '确认边界接入记录.json')); 检查运行副本(); return report;
}
export async function 加载任务确认与设置边界磁盘服务(integration) {
  if (integration.服务包 !== join(integration.组合包, '服务包') || integration.副本 !== join(integration.组合包, '画布副本')) throw Error('确认边界服务映射不符');
  核验任务确认与设置边界完整包(integration.组合包, true);
  const modules = await Promise.all(['扩展功能/本机服务/数据服务.mjs', '扩展功能/本机存储/SQLite工作区.mjs'].map(path => import(pathToFileURL(join(integration.服务包, path)).href)));
  核验任务确认与设置边界完整包(integration.组合包, true); return Object.assign({}, ...modules);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--应用已批准9文件到新隔离副本') throw Error('仅允许九文件新隔离接入');
  console.log(JSON.stringify(建立任务确认与设置边界隔离副本(), null, 2));
}
