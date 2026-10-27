import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 生成SQLite工作台授权候选 } from './预审SQLite工作台授权入口.mjs';
import { 建立SQLite启动存储隔离副本 } from './接入SQLite启动存储隔离副本.mjs';
import { 生成审查差异, 预审类型 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取授权入口批准, 授权入口差异SHA256, 检查授权入口后继, 核验授权入口自有依赖 } from '../上游适配/SQLite工作台授权入口批准.mjs';

export function 授权入口批准产物() {
  const manifest = 读取授权入口批准(); 核验授权入口自有依赖(根目录);
  const result = 生成SQLite工作台授权候选();
  if (result.delta.size !== 9 || 哈希(生成审查差异(result.delta)) !== 授权入口差异SHA256) throw Error('授权入口重建差异偏离批准内容');
  for (const item of manifest.文件) {
    const value = result.delta.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('授权入口重建产物指纹不符');
  }
  return result;
}
function sourceHashes(root) {
  const files = new Map();
  function walk(path, relative = '') {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', '.DS_Store', 'tsconfig.tsbuildinfo'].includes(entry.name)) continue;
      const target = join(path, entry.name), name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(target, name);
      else {
        if (!entry.isFile() || lstatSync(target).nlink !== 1) throw Error('隔离源文件出现链接或未知类型');
        files.set(name, 哈希(readFileSync(target)));
      }
    }
  }
  walk(root); return files;
}
// 始终新建副本，并作为第四次独立快照事务接入。没有生产路径、重启或跳过检查选项。
export function 建立SQLite工作台授权隔离副本() {
  const { delta, combined } = 授权入口批准产物();
  预审类型(new Map([...combined].filter(([path]) => /\.(ts|tsx)$/.test(path))));
  const integration = 建立SQLite启动存储隔离副本(), root = integration.副本;
  const snapshot = join(dirname(root), '工作台授权事务快照'), before = sourceHashes(root);
  if (检查授权入口后继(root)) throw Error('新副本已存在授权入口后态');
  事务写入(root, delta, snapshot, { 差异指纹: 授权入口差异SHA256, 写后检查() {
    if (!检查授权入口后继(root)) throw Error('授权入口后继未完整接入');
    核验授权入口自有依赖(根目录);
    const after = sourceHashes(root);
    for (const [path, hash] of before) if (!delta.has(path) && after.get(path) !== hash) throw Error('隔离副本出现范围外修改：' + path);
    for (const path of after.keys()) if (!before.has(path) && !delta.has(path)) throw Error('隔离副本出现范围外新增：' + path);
  } });
  检查运行副本();
  const report = { ...integration, 授权入口差异SHA256, 授权入口已接入: true, 授权入口事务快照: snapshot, 授权入口文件数: delta.size, 未接管3100: true };
  writeFileSync(join(dirname(root), '工作台授权接入记录.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return report;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw Error('只创建已批准的隔离副本，不接受生产路径或应用选项');
  console.log(JSON.stringify(建立SQLite工作台授权隔离副本(), null, 2));
}
