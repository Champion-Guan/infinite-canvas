import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SQLite批准产物, 建立SQLite隔离副本 } from './接入SQLite隔离副本.mjs';
import { 节点存储路径, 节点存储惰性候选 } from './预审SQLite节点存储.mjs';
import { 生成审查差异, 预审类型 } from './检查首批功能适配.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 检查SQLite批次, 核验SQLite自有依赖 } from '../上游适配/SQLite全面替换批准.mjs';
import { 根目录 } from './公共.mjs';
import { 读取节点存储批准, 检查节点存储后继, 节点存储差异SHA256 } from '../上游适配/SQLite节点存储批准.mjs';

export function 节点存储批准产物() {
  const manifest = 读取节点存储批准(), files = SQLite批准产物();
  const before = files.get(节点存储路径).产物, after = 节点存储惰性候选(before);
  const delta = new Map([[节点存储路径, { 原文: before, 产物: after }]]), item = manifest.文件[0];
  if (哈希(before) !== item.原始SHA256 || 哈希(after) !== item.候选SHA256 || 哈希(生成审查差异(delta)) !== 节点存储差异SHA256) throw Error('节点存储重建产物偏离批准内容');
  const combined = new Map(files);
  combined.set(节点存储路径, { ...files.get(节点存储路径), 产物: after });
  return { delta, combined };
}

// 仅新建隔离副本；没有生产路径/跳过校验参数。避免改写历史25文件接入器或循环导入。
export function 建立SQLite节点存储隔离副本() {
  const { delta, combined } = 节点存储批准产物();
  预审类型(combined);
  const integration = 建立SQLite隔离副本({ 类型预审: false });
  const root = integration.副本, snapshot = join(dirname(root), '节点存储事务快照');
  if (检查节点存储后继(root)) throw Error('新副本不是完整25文件前置');
  事务写入(root, delta, snapshot, {
    差异指纹: 节点存储差异SHA256,
    写入前() { if (检查节点存储后继(root)) throw Error('节点存储前态发生变化'); },
    写后检查() { if (!检查节点存储后继(root)) throw Error('节点存储后继未完整接入'); 核验SQLite自有依赖(根目录); },
  });
  检查运行副本();
  if (检查SQLite批次(运行目录)) throw Error('不允许接管3100');
  const report = { ...integration, 节点存储差异SHA256, 节点存储已接入: true, 节点存储事务快照: snapshot };
  writeFileSync(join(dirname(root), '节点存储接入记录.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw Error('只创建隔离副本，不接受生产路径或应用选项');
  console.log(JSON.stringify(建立SQLite节点存储隔离副本(), null, 2));
}
