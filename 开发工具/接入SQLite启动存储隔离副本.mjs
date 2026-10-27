import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 生成审查差异, 预审类型 } from './检查首批功能适配.mjs';
import { 生成SQLite启动候选 } from './预审SQLite启动存储.mjs';
import { 建立SQLite节点存储隔离副本 } from './接入SQLite节点存储隔离副本.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 检查SQLite批次 } from '../上游适配/SQLite全面替换批准.mjs';
import { 读取启动存储批准, 检查启动存储后继, 核验启动存储自有依赖, 启动存储差异SHA256 } from '../上游适配/SQLite启动存储批准.mjs';

export function 启动存储批准产物() {
  const manifest = 读取启动存储批准();
  核验启动存储自有依赖(根目录);
  const { delta, combined } = 生成SQLite启动候选();
  if (delta.size !== 3 || 哈希(生成审查差异(delta)) !== 启动存储差异SHA256) throw Error('启动存储重建差异偏离批准内容');
  for (const item of manifest.文件) {
    const value = delta.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('启动存储重建产物指纹不符');
  }
  return { delta, combined };
}

// 无生产目录/跳过保护选项，始终新建副本，并以第三次独立快照事务接入3文件。
export function 建立SQLite启动存储隔离副本() {
  const { delta, combined } = 启动存储批准产物();
  预审类型(new Map([...combined].filter(([path]) => /\.(ts|tsx)$/.test(path))));
  const integration = 建立SQLite节点存储隔离副本();
  const root = integration.副本, snapshot = join(dirname(root), '启动存储事务快照');
  if (检查启动存储后继(root)) throw Error('新副本已接入启动后继，前态异常');
  事务写入(root, delta, snapshot, {
    差异指纹: 启动存储差异SHA256,
    写后检查() {
      if (!检查启动存储后继(root)) throw Error('启动存储后继未完整接入');
      核验启动存储自有依赖(根目录);
    },
  });
  检查运行副本();
  if (检查SQLite批次(运行目录)) throw Error('不允许接管3100');
  const report = { ...integration, 启动存储差异SHA256, 启动存储已接入: true, 启动存储事务快照: snapshot };
  writeFileSync(join(dirname(root), '启动存储接入记录.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return report;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw Error('只创建隔离副本，不接受生产路径或应用选项');
  console.log(JSON.stringify(建立SQLite启动存储隔离副本(), null, 2));
}
