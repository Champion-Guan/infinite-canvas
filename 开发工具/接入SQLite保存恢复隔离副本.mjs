import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 构建保存恢复候选 } from './预审SQLite保存恢复.mjs';
import { 建立SQLite免填码隔离副本 } from './接入SQLite免填码隔离副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 媒体启动器路径 } from '../上游适配/SQLite临时媒体策略批准.mjs';
import { 读取保存恢复批准, 核验保存恢复自有依赖, 检查保存恢复后继, 保存恢复差异SHA256 } from '../上游适配/SQLite保存恢复批准.mjs';

export function 保存恢复批准产物() {
  const manifest = 读取保存恢复批准(); 核验保存恢复自有依赖(根目录);
  const { delta } = 构建保存恢复候选();
  if (delta.size !== 5 || 哈希(生成审查差异(delta)) !== 保存恢复差异SHA256) throw Error('保存恢复重建差异偏离批准内容');
  for (const item of manifest.文件) {
    const value = delta.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('保存恢复重建产物指纹不符');
  }
  return delta;
}
function sourceHashes(root) {
  const result = new Map();
  function walk(path = '') {
    for (const name of readdirSync(join(root, path))) {
      if (['node_modules', '.git', 'dist', '.DS_Store', 'tsconfig.tsbuildinfo'].includes(name)) continue;
      const relative = path ? path + '/' + name : name, stat = lstatSync(join(root, relative));
      if (stat.isSymbolicLink()) throw Error('隔离源文件出现链接');
      if (stat.isDirectory()) walk(relative);
      else if (!stat.isFile() || stat.nlink !== 1) throw Error('隔离源文件类型不安全');
      else result.set(relative, 哈希(readFileSync(join(root, relative))));
    }
  }
  walk(); return result;
}
// 没有生产目标/端口/重启或跳过检查参数，始终建立完整新隔离副本。
export function 建立SQLite保存恢复隔离副本() {
  检查运行副本(); const delta = 保存恢复批准产物();
  const integration = 建立SQLite免填码隔离副本(), root = integration.副本;
  if (检查保存恢复后继(root)) throw Error('保存恢复接入前态不符');
  const before = sourceHashes(root), snapshot = join(dirname(root), '保存恢复事务快照');
  事务写入(root, delta, snapshot, { 差异指纹: 保存恢复差异SHA256, 写后检查() {
    if (!检查保存恢复后继(root)) throw Error('保存恢复后继未完整接入'); 核验保存恢复自有依赖(根目录);
    const after = sourceHashes(root);
    for (const [path, hash] of before) if (!delta.has(path) && after.get(path) !== hash) throw Error('保存恢复范围外修改：' + path);
    for (const path of after.keys()) if (!before.has(path) && !delta.has(path)) throw Error('保存恢复范围外新增：' + path);
  } });
  检查运行副本();
  const report = { ...integration, 保存恢复差异SHA256, 保存恢复已接入: true, 保存恢复文件数: delta.size, 保存恢复事务快照: snapshot, 已接管3100: false };
  writeFileSync(join(dirname(root), '保存恢复接入记录.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}
export async function 加载SQLite保存恢复隔离启动器(integration) {
  if (!检查保存恢复后继(integration.副本)) throw Error('只加载完整批准的保存恢复装配');
  const module = await import(pathToFileURL(join(integration.副本, 媒体启动器路径)).href);
  if (!检查保存恢复后继(integration.副本)) throw Error('保存恢复装配加载期间改变');
  return module;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw Error('只新建保存恢复隔离副本，不接受生产目录或跳过检查选项');
  console.log(JSON.stringify(建立SQLite保存恢复隔离副本(), null, 2));
}
