import { cpSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 哈希, 检查运行副本, 运行目录 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取Excel删除视觉继承隔离记录 as 读取前置隔离记录 } from './接入Excel删除视觉继承隔离副本.mjs';
import { 删除平滑前置, 构建删除平滑候选 } from './预审Excel删除字体平滑.mjs';
import { 读取Excel删除字体平滑批准, 核验Excel删除字体平滑来源, Excel删除字体平滑差异SHA256, Excel删除字体平滑清单SHA256 } from '../上游适配/Excel删除字体平滑批准.mjs';
import { SQLite安全指纹 } from '../上游适配/SQLite全面替换批准.mjs';

const mapped = path => '画布副本/' + path;
function inventory(root) {
  if (realpathSync(root) !== resolve(root) || !lstatSync(root).isDirectory()) throw Error('Excel删除字体平滑根不是独立目录');
  const result = new Map();
  function walk(path = '') {
    for (const name of readdirSync(join(root, path))) {
      const relative = path ? path + '/' + name : name, file = join(root, relative), stat = lstatSync(file);
      if (relative === '画布副本/web/node_modules') {
        if (!stat.isSymbolicLink() || realpathSync(file) !== realpathSync(join(运行目录, 'web/node_modules'))) throw Error('Excel删除字体平滑依赖链接不符');
        result.set(relative, 'approved-dependencies'); continue;
      }
      if (stat.isSymbolicLink()) throw Error('Excel删除字体平滑拒绝源码链接');
      if (stat.isDirectory()) { result.set(relative, 'directory'); walk(relative); }
      else if (!stat.isFile() || stat.nlink !== 1) throw Error('Excel删除字体平滑拒绝特殊文件或硬链接');
      else result.set(relative, 哈希(readFileSync(file)));
    }
  }
  walk(); return result;
}
function expectedBefore() {
  const manifest = 读取Excel删除字体平滑批准(); 核验Excel删除字体平滑来源(根目录);
  if (manifest.前置记录 !== 删除平滑前置) throw Error('Excel删除字体平滑前置路径不符');
  const previous = 读取前置隔离记录(删除平滑前置);
  if (previous.差异SHA256 !== manifest.前置差异SHA256) throw Error('Excel删除字体平滑前置差异不符');
  const expected = inventory(previous.组合包);
  for (const item of manifest.文件) if ((expected.get(mapped(item.文件)) ?? null) !== item.原始SHA256) throw Error('Excel删除字体平滑前态不符：' + item.文件);
  return { expected, previous, manifest };
}
export function 核验Excel删除字体平滑完整包(root, after) {
  if (typeof after !== 'boolean') throw Error('Excel删除字体平滑必须明确完整前态或后态');
  const { expected, manifest } = expectedBefore(), actual = inventory(root);
  if (after) for (const item of manifest.文件) {
    const path = mapped(item.文件); expected.set(path, item.候选SHA256);
    let parent = dirname(path);
    while (parent !== '.') { if (!expected.has(parent)) expected.set(parent, 'directory'); parent = dirname(parent); }
  }
  for (const item of manifest.文件) if ((actual.get(mapped(item.文件)) ?? null) !== (expected.get(mapped(item.文件)) ?? null)) throw Error('Excel删除字体平滑前后态错误：' + item.文件);
  if (actual.size !== expected.size || [...expected].some(([path, hash]) => actual.get(path) !== hash)) throw Error('Excel删除字体平滑范围外源码、未知文件或目录改变');
  return true;
}
export function Excel删除字体平滑批准产物() {
  const manifest = 读取Excel删除字体平滑批准(); 核验Excel删除字体平滑来源(根目录);
  const preview = 构建删除平滑候选();
  if (preview.delta.size !== 1 || 哈希(生成审查差异(preview.delta)) !== Excel删除字体平滑差异SHA256) throw Error('Excel删除字体平滑重建差异偏离批准');
  const result = new Map();
  for (const item of manifest.文件) {
    const value = preview.delta.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('Excel删除字体平滑重建产物偏离批准');
    result.set(mapped(item.文件), value);
  }
  return result;
}
export function 建立Excel删除字体平滑隔离副本() {
  检查运行副本();
  const { previous } = expectedBefore(), delta = Excel删除字体平滑批准产物();
  const home = mkdtempSync(join(根目录, '.运行/Excel删除字体平滑-')), root = join(home, '组合包');
  cpSync(previous.组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true });
  核验Excel删除字体平滑完整包(root, false);
  const snapshot = join(home, 'Excel删除字体平滑事务快照');
  事务写入(root, delta, snapshot, { 差异指纹: Excel删除字体平滑差异SHA256, 写后检查() { 核验Excel删除字体平滑完整包(root, true); } });
  const report = { 组合包: root, 副本: join(root, '画布副本'), 服务包: join(root, '服务包'), 事务快照: snapshot,
    前置记录: 删除平滑前置, 差异SHA256: Excel删除字体平滑差异SHA256, 清单SHA256: Excel删除字体平滑清单SHA256,
    文件数: 1, 已接入隔离副本: true, 已接管3100: false, 已访问Keychain: false };
  writeFileSync(join(home, 'Excel删除字体平滑接入记录.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  检查运行副本(); return report;
}
export function 读取Excel删除字体平滑隔离记录(path) {
  const record = resolve(path), home = dirname(record), root = join(home, '组合包');
  if (!home.startsWith(resolve(根目录, '.运行') + sep) || !/^Excel删除字体平滑-[A-Za-z0-9]+$/.test(home.split(sep).at(-1)) ||
      record !== join(home, 'Excel删除字体平滑接入记录.json') || realpathSync(record) !== record || !lstatSync(record).isFile() || lstatSync(record).nlink !== 1) throw Error('只接受Excel删除字体平滑隔离记录');
  const integration = JSON.parse(readFileSync(record)), manifest = 读取Excel删除字体平滑批准();
  if (integration.组合包 !== root || integration.副本 !== join(root, '画布副本') || integration.服务包 !== join(root, '服务包') ||
      integration.事务快照 !== join(home, 'Excel删除字体平滑事务快照') || integration.前置记录 !== 删除平滑前置 || integration.差异SHA256 !== Excel删除字体平滑差异SHA256 ||
      integration.清单SHA256 !== Excel删除字体平滑清单SHA256 || integration.文件数 !== 1 || integration.已接入隔离副本 !== true || integration.已接管3100 !== false || integration.已访问Keychain !== false) throw Error('Excel删除字体平滑记录不完整');
  if (!SQLite安全指纹(home, 'Excel删除字体平滑事务快照/事务.json')) throw Error('Excel删除字体平滑事务缺失');
  const journal = JSON.parse(readFileSync(join(integration.事务快照, '事务.json')));
  if (journal.上游提交 !== manifest.上游提交 || journal.状态 !== '完成' || journal.差异SHA256 !== Excel删除字体平滑差异SHA256 || journal.文件?.length !== 1) throw Error('Excel删除字体平滑事务不完整');
  for (const [index, item] of manifest.文件.entries()) {
    const saved = journal.文件[index];
    if (saved.路径 !== mapped(item.文件) || saved.原始SHA256 !== item.原始SHA256 || saved.产物SHA256 !== item.候选SHA256 ||
        SQLite安全指纹(home, 'Excel删除字体平滑事务快照/接入前/' + mapped(item.文件)) !== item.原始SHA256) throw Error('Excel删除字体平滑事务或原态快照不符');
  }
  核验Excel删除字体平滑完整包(root, true); return integration;
}
export async function 加载Excel删除字体平滑磁盘服务(integration) {
  if (integration.服务包 !== join(integration.组合包, '服务包') || integration.副本 !== join(integration.组合包, '画布副本')) throw Error('Excel删除字体平滑服务映射不符');
  核验Excel删除字体平滑完整包(integration.组合包, true);
  const modules = await Promise.all(['扩展功能/本机服务/数据服务.mjs', '扩展功能/本机存储/SQLite工作区.mjs'].map(path => import(pathToFileURL(join(integration.服务包, path)).href)));
  核验Excel删除字体平滑完整包(integration.组合包, true); return Object.assign({}, ...modules);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--应用已批准一文件到新隔离副本') throw Error('仅允许Excel删除字体平滑新隔离接入');
  console.log(JSON.stringify(建立Excel删除字体平滑隔离副本(), null, 2));
}
